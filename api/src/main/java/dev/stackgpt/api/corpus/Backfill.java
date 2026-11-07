package dev.stackgpt.api.corpus;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.stackgpt.api.embed.Embedder;
import dev.stackgpt.api.extract.Extraction;
import dev.stackgpt.api.extract.ProblemExtractor;
import tools.jackson.databind.ObjectMapper;

/**
 * At startup and then periodically, fills derived columns for rows the seed left empty (embedding is null):
 * problems get embedding + error_sigs (+ env when empty; curated env is kept), solutions get embedding.
 * Batched; O(rows) embeddings.
 */
@Component
@ConditionalOnProperty(name = "stackgpt.backfill.enabled", havingValue = "true")
public class Backfill {
	private static final Logger log = LoggerFactory.getLogger(Backfill.class);
	static final int BATCH = 32;

	record P(long id, String text, String sigText, boolean noEnv) {}

	record S(long id, String text) {}

	private final JdbcTemplate jdbc;
	private final Embedder emb;
	private final ProblemExtractor ex;
	private final ObjectMapper json;

	public Backfill(JdbcTemplate jdbc, Embedder emb, ProblemExtractor ex, ObjectMapper json) {
		this.jdbc = jdbc;
		this.emb = emb;
		this.ex = ex;
		this.json = json;
	}

	@Scheduled(initialDelay = 0, fixedDelayString = "${stackgpt.backfill.interval-ms:30000}")
	public void run() {
		long t0 = System.currentTimeMillis();
		int np = problems(), ns = solutions();
		if (np + ns > 0) log.info("backfilled {} problems, {} solutions in {} ms", np, ns, System.currentTimeMillis() - t0);
	}

	int problems() {
		int n = 0;
		for (List<P> b = nextProblems(); !b.isEmpty(); b = nextProblems()) {
			List<float[]> v = emb.embedAll(b.stream().map(P::text).toList());
			for (int i = 0; i < b.size(); i++) update(b.get(i), v.get(i));
			n += b.size();
		}
		return n;
	}

	int solutions() {
		int n = 0;
		for (List<S> b = nextSolutions(); !b.isEmpty(); b = nextSolutions()) {
			List<float[]> v = emb.embedAll(b.stream().map(S::text).toList());
			for (int i = 0; i < b.size(); i++)
				jdbc.update("update solutions set embedding = ?::vector where id = ?", Embedder.literal(v.get(i)), b.get(i).id());
			n += b.size();
		}
		return n;
	}

	private List<P> nextProblems() {
		return jdbc.query("""
				select id, title || E'\\n\\n' || body text, array_to_string(tags, ' ') tags, env = '{}'::jsonb no_env
				from problems where embedding is null order by id limit ?""",
				(rs, i) -> new P(rs.getLong("id"), rs.getString("text"), rs.getString("text") + "\n" + rs.getString("tags"),
						rs.getBoolean("no_env")), BATCH);
	}

	private List<S> nextSolutions() {
		return jdbc.query("""
				select id, body || E'\\n' || coalesce((select string_agg(x, E'\\n') from jsonb_array_elements_text(steps) x), '')
				       || E'\\n' || coalesce(code, '') text
				from solutions where embedding is null order by id limit ?""",
				(rs, i) -> new S(rs.getLong("id"), rs.getString("text")), BATCH);
	}

	private void update(P p, float[] v) {
		Extraction x = ex.extract(p.sigText());
		jdbc.update(c -> {
			var ps = c.prepareStatement("""
					update problems set embedding = ?::vector, error_sigs = ?,
					  env = case when ? then ?::jsonb else env end
					where id = ?""");
			ps.setString(1, Embedder.literal(v));
			ps.setArray(2, c.createArrayOf("text", x.errorSigs().toArray()));
			ps.setBoolean(3, p.noEnv());
			ps.setString(4, json.writeValueAsString(x.env()));
			ps.setLong(5, p.id());
			return ps;
		});
	}
}
