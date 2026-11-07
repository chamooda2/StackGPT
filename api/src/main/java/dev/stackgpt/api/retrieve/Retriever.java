package dev.stackgpt.api.retrieve;

import java.sql.Array;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import dev.stackgpt.api.embed.Embedder;

/**
 * Three candidate lists over problems, each top-K by its own relevance:
 * vector (HNSW cosine, ~O(log n)), full-text (GIN, any-term match ranked by ts_rank_cd),
 * and exact error-signature overlap (GIN &&, ranked by number of shared signatures).
 */
@Component
public class Retriever {
	public static final int K = 50;

	public record Lists(List<Long> vector, List<Long> text, List<Long> sig) {
		public List<List<Long>> all() {
			return List.of(vector, text, sig);
		}
	}

	private final JdbcTemplate jdbc;

	public Retriever(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	public Lists search(String statement, float[] q, List<String> sigs) {
		return new Lists(vector(q), text(statement), sig(sigs));
	}

	List<Long> vector(float[] q) {
		return jdbc.queryForList("""
				select id from problems where embedding is not null
				order by embedding <=> ?::vector limit ?""", Long.class, Embedder.literal(q), K);
	}

	// plainto_tsquery ANDs every term, which misses on long questions; OR the lexemes instead.
	// Re-parsed with 'simple' so the already-stemmed English lexemes are kept as-is.
	List<Long> text(String statement) {
		return jdbc.queryForList("""
				select p.id from problems p,
				  to_tsquery('simple', replace(plainto_tsquery('english', ?)::text, '&', '|')) q
				where p.fts @@ q
				order by ts_rank_cd(p.fts, q) desc, p.id limit ?""", Long.class, statement, K);
	}

	List<Long> sig(List<String> sigs) {
		if (sigs.isEmpty()) return List.of();
		return jdbc.query(c -> {
			var ps = c.prepareStatement("""
					select id from problems where error_sigs && ?
					order by cardinality(array(select unnest(error_sigs) intersect select unnest(?))) desc, id
					limit ?""");
			Array a = c.createArrayOf("text", sigs.toArray());
			ps.setArray(1, a);
			ps.setArray(2, a);
			ps.setInt(3, K);
			return ps;
		}, (rs, i) -> rs.getLong(1));
	}
}
