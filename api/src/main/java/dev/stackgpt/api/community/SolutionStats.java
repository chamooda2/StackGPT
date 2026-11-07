package dev.stackgpt.api.community;

import java.sql.Array;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import dev.stackgpt.api.context.ContextMatcher.Att;
import dev.stackgpt.api.verify.Dto.Flags;
import dev.stackgpt.api.verify.Dto.Mine;
import dev.stackgpt.api.verify.Dto.Votes;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Community evidence per solution: all attempts (needed for context and trust), vote and flag counts, and the
 * requesting user's own report. Three queries; O(a) rows for a attempts, votes/flags aggregated in SQL.
 */
@Component
public class SolutionStats {
	private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

	public record Stats(List<Att> attempts, Votes votes, Flags flags, Mine mine) {}

	private final JdbcTemplate jdbc;
	private final ObjectMapper json;

	public SolutionStats(JdbcTemplate jdbc, ObjectMapper json) {
		this.jdbc = jdbc;
		this.json = json;
	}

	/** @param user requesting user, or null for anonymous reads */
	public Map<Long, Stats> load(Collection<Long> ids, Long user) {
		if (ids.isEmpty()) return Map.of();
		Long[] arr = ids.toArray(Long[]::new);
		long u = user == null ? -1 : user;
		Map<Long, List<Att>> atts = new HashMap<>();
		Map<Long, String> outcome = new HashMap<>();
		Map<Long, Votes> votes = new HashMap<>();
		Map<Long, Boolean> helpful = new HashMap<>();
		Map<Long, Flags> flags = new HashMap<>();
		Map<Long, List<String>> myFlags = new HashMap<>();

		jdbc.query(c -> {
			var ps = c.prepareStatement("""
					select solution_id, outcome, synthetic, env::text, created_at, user_id = ? mine
					from attempts where solution_id = any(?)""");
			ps.setLong(1, u);
			ps.setArray(2, c.createArrayOf("bigint", arr));
			return ps;
		}, rs -> {
			long id = rs.getLong("solution_id");
			atts.computeIfAbsent(id, k -> new ArrayList<>()).add(new Att(rs.getString("outcome"), rs.getBoolean("synthetic"),
					json.readValue(rs.getString("env"), MAP), rs.getTimestamp("created_at").toInstant()));
			if (rs.getBoolean("mine")) outcome.put(id, rs.getString("outcome"));
		});
		jdbc.query(c -> {
			var ps = c.prepareStatement("""
					select solution_id, count(*) filter (where helpful) h, count(*) filter (where not helpful) nh,
					       bool_or(helpful) filter (where user_id = ?) mine
					from votes where solution_id = any(?) group by solution_id""");
			ps.setLong(1, u);
			ps.setArray(2, c.createArrayOf("bigint", arr));
			return ps;
		}, rs -> {
			long id = rs.getLong("solution_id");
			votes.put(id, new Votes(rs.getInt("h"), rs.getInt("nh")));
			boolean m = rs.getBoolean("mine");
			if (!rs.wasNull()) helpful.put(id, m);
		});
		jdbc.query(c -> {
			var ps = c.prepareStatement("""
					select solution_id, count(*) filter (where kind = 'outdated') o, count(*) filter (where kind = 'misleading') m,
					       array_agg(kind order by kind) filter (where user_id = ?) mine
					from flags where solution_id = any(?) group by solution_id""");
			ps.setLong(1, u);
			ps.setArray(2, c.createArrayOf("bigint", arr));
			return ps;
		}, rs -> {
			long id = rs.getLong("solution_id");
			flags.put(id, new Flags(rs.getInt("o"), rs.getInt("m")));
			Array a = rs.getArray("mine");
			if (a != null) myFlags.put(id, List.of((String[]) a.getArray()));
		});

		Map<Long, Stats> out = new HashMap<>();
		for (Long id : ids)
			out.put(id, new Stats(atts.getOrDefault(id, List.of()), votes.getOrDefault(id, new Votes(0, 0)),
					flags.getOrDefault(id, new Flags(0, 0)),
					new Mine(outcome.get(id), helpful.get(id), myFlags.getOrDefault(id, List.of()))));
		return out;
	}
}
