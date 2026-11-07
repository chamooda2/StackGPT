package dev.stackgpt.api.verify;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import dev.stackgpt.api.embed.Embedder;
import dev.stackgpt.api.retrieve.Rrf;
import dev.stackgpt.api.verify.Dto.Match;
import dev.stackgpt.api.verify.Dto.Outcomes;
import dev.stackgpt.api.verify.Dto.Ranks;
import dev.stackgpt.api.verify.Dto.Solution;
import dev.stackgpt.api.verify.Dto.Source;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** Loads problem details, solutions and attempt counts for fused hits. Two queries, O(h + s) rows. */
@Component
public class MatchLoader {
	private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
	private static final TypeReference<List<String>> LIST = new TypeReference<>() {};

	private final JdbcTemplate jdbc;
	private final ObjectMapper json;

	public MatchLoader(JdbcTemplate jdbc, ObjectMapper json) {
		this.jdbc = jdbc;
		this.json = json;
	}

	public List<Match> load(List<Rrf.Scored> hits, float[] q) {
		if (hits.isEmpty()) return List.of();
		Long[] ids = hits.stream().map(Rrf.Scored::id).toArray(Long[]::new);
		Map<Long, List<Solution>> sols = solutions(ids);
		Map<Long, Match> byId = new HashMap<>();
		Map<Long, Rrf.Scored> hit = new HashMap<>();
		hits.forEach(h -> hit.put(h.id(), h));

		jdbc.query(c -> {
			var ps = c.prepareStatement("""
					select id, domain, title, env::text, error_sigs, source, source_id, source_url, author, license,
					       case when embedding is null then null else 1 - (embedding <=> ?::vector) end sim
					from problems where id = any(?)""");
			ps.setString(1, Embedder.literal(q));
			ps.setArray(2, c.createArrayOf("bigint", ids));
			return ps;
		}, rs -> {
			long id = rs.getLong("id");
			Rrf.Scored h = hit.get(id);
			double sim = rs.getDouble("sim");
			byId.put(id, new Match(id, rs.getString("domain"), rs.getString("title"), h.score(),
					rs.wasNull() ? null : sim, new Ranks(rank(h, 0), rank(h, 1), rank(h, 2)),
					json.readValue(rs.getString("env"), MAP), strings(rs.getArray("error_sigs")), source(rs),
					sols.getOrDefault(id, List.of())));
		});
		return hits.stream().map(h -> byId.get(h.id())).toList();
	}

	private Map<Long, List<Solution>> solutions(Long[] ids) {
		Map<Long, List<Solution>> out = new HashMap<>();
		jdbc.query(c -> {
			var ps = c.prepareStatement("""
					select s.id, s.problem_id, s.body, s.steps::text, s.code, s.score, s.is_accepted,
					       s.source, s.source_id, s.source_url, s.author, s.license,
					       count(a.id) filter (where a.outcome = 'worked')  worked,
					       count(a.id) filter (where a.outcome = 'partial') partial,
					       count(a.id) filter (where a.outcome = 'failed')  failed,
					       count(a.id) filter (where a.synthetic)           synthetic,
					       max(a.created_at) last_attempt
					from solutions s left join attempts a on a.solution_id = s.id
					where s.problem_id = any(?)
					group by s.id order by s.problem_id, s.is_accepted desc, s.id""");
			ps.setArray(1, c.createArrayOf("bigint", ids));
			return ps;
		}, rs -> {
			int score = rs.getInt("score");
			Integer sc = rs.wasNull() ? null : score;
			Timestamp last = rs.getTimestamp("last_attempt");
			out.computeIfAbsent(rs.getLong("problem_id"), k -> new ArrayList<>()).add(new Solution(
					rs.getLong("id"), rs.getString("body"), json.readValue(rs.getString("steps"), LIST), rs.getString("code"),
					sc, rs.getBoolean("is_accepted"), source(rs),
					new Outcomes(rs.getInt("worked"), rs.getInt("partial"), rs.getInt("failed"), rs.getInt("synthetic"),
							last == null ? null : last.toInstant())));
		});
		return out;
	}

	private static Integer rank(Rrf.Scored h, int i) {
		return h.ranks()[i] == 0 ? null : h.ranks()[i];
	}

	private static Source source(ResultSet rs) throws SQLException {
		return new Source(rs.getString("source"), rs.getString("source_id"), rs.getString("source_url"),
				rs.getString("author"), rs.getString("license"));
	}

	private static List<String> strings(Array a) throws SQLException {
		return a == null ? List.of() : List.of((String[]) a.getArray());
	}
}
