package dev.stackgpt.api.verify;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import dev.stackgpt.api.community.SolutionStats;
import dev.stackgpt.api.community.SolutionStats.Stats;
import dev.stackgpt.api.context.ContextMatcher.Att;
import dev.stackgpt.api.embed.Embedder;
import dev.stackgpt.api.verify.Dto.Source;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Loads candidate problems, their solutions (with similarity to the AI answer) and community stats.
 * Two queries plus SolutionStats; O(h + s + a) rows for h problems, s solutions, a attempts.
 */
@Component
public class MatchLoader {
	private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
	private static final TypeReference<List<String>> LIST = new TypeReference<>() {};

	public record Row(long id, String domain, String title, Double similarity, Map<String, Object> env,
			List<String> errorSigs, Source source, List<SolRow> solutions) {}

	public record SolRow(long id, String body, List<String> steps, String code, Integer score, boolean accepted,
			Source source, Double answerSimilarity, Stats stats) {
		public List<Att> attempts() {
			return stats.attempts();
		}
	}

	private final JdbcTemplate jdbc;
	private final ObjectMapper json;
	private final SolutionStats stats;

	public MatchLoader(JdbcTemplate jdbc, ObjectMapper json, SolutionStats stats) {
		this.jdbc = jdbc;
		this.json = json;
		this.stats = stats;
	}

	/**
	 * @param a    the AI answer's embedding, or null
	 * @param user requesting user (for their own reports), or null
	 */
	public Map<Long, Row> load(List<Long> problemIds, float[] q, float[] a, Long user) {
		if (problemIds.isEmpty()) return Map.of();
		Long[] ids = problemIds.toArray(Long[]::new);
		Map<Long, List<SolRow>> sols = solutions(ids, a, user);
		Map<Long, Row> out = new HashMap<>();
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
			out.put(id, new Row(id, rs.getString("domain"), rs.getString("title"), dbl(rs, "sim"),
					json.readValue(rs.getString("env"), MAP), strings(rs.getArray("error_sigs")), source(rs),
					sols.getOrDefault(id, List.of())));
		});
		return out;
	}

	private record Base(long id, String body, List<String> steps, String code, Integer score, boolean accepted,
			Source source, Double answerSimilarity) {}

	private Map<Long, List<SolRow>> solutions(Long[] problemIds, float[] a, Long user) {
		Map<Long, List<SolRow>> out = new HashMap<>();
		List<long[]> order = new ArrayList<>();
		Map<Long, Base> rows = new HashMap<>();
		jdbc.query(c -> {
			var ps = c.prepareStatement("""
					select id, problem_id, body, steps::text, code, score, is_accepted, source, source_id, source_url, author, license,
					       case when ?::boolean and embedding is not null then 1 - (embedding <=> ?::vector) end ans_sim
					from solutions where problem_id = any(?)
					order by problem_id, is_accepted desc, id""");
			ps.setBoolean(1, a != null);
			ps.setString(2, a == null ? null : Embedder.literal(a));
			ps.setArray(3, c.createArrayOf("bigint", problemIds));
			return ps;
		}, rs -> {
			long id = rs.getLong("id");
			int sc = rs.getInt("score");
			Integer score = rs.wasNull() ? null : sc;
			rows.put(id, new Base(id, rs.getString("body"), json.readValue(rs.getString("steps"), LIST),
					rs.getString("code"), score, rs.getBoolean("is_accepted"), source(rs), dbl(rs, "ans_sim")));
			order.add(new long[] { rs.getLong("problem_id"), id });
		});
		Map<Long, Stats> st = stats.load(rows.keySet(), user);
		for (long[] o : order) {
			Base b = rows.get(o[1]);
			out.computeIfAbsent(o[0], k -> new ArrayList<>()).add(new SolRow(b.id(), b.body(), b.steps(), b.code(),
					b.score(), b.accepted(), b.source(), b.answerSimilarity(), st.get(b.id())));
		}
		return out;
	}

	private static Double dbl(ResultSet rs, String col) throws SQLException {
		double d = rs.getDouble(col);
		return rs.wasNull() ? null : d;
	}

	private static Source source(ResultSet rs) throws SQLException {
		return new Source(rs.getString("source"), rs.getString("source_id"), rs.getString("source_url"),
				rs.getString("author"), rs.getString("license"));
	}

	private static List<String> strings(Array a) throws SQLException {
		return a == null ? List.of() : List.of((String[]) a.getArray());
	}
}
