package dev.stackgpt.api.retrieve;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reciprocal Rank Fusion: score(d) = sum over lists of 1 / (K + rank), rank 1-based.
 * Time O(N + m log m) for N total list entries and m distinct ids; space O(m).
 */
public final class Rrf {
	public static final int K = 60;

	/** ranks[i] = 1-based rank in list i, or 0 when absent. */
	public record Scored(long id, double score, int[] ranks) {}

	private Rrf() {}

	public static List<Scored> fuse(List<List<Long>> lists) {
		int n = lists.size();
		Map<Long, int[]> ranks = new LinkedHashMap<>();
		for (int i = 0; i < n; i++) {
			List<Long> l = lists.get(i);
			for (int r = 0; r < l.size(); r++) {
				int[] rk = ranks.computeIfAbsent(l.get(r), k -> new int[n]);
				if (rk[i] == 0) rk[i] = r + 1;
			}
		}
		List<Scored> out = new ArrayList<>(ranks.size());
		ranks.forEach((id, rk) -> {
			double s = 0;
			for (int r : rk) if (r > 0) s += 1.0 / (K + r);
			out.add(new Scored(id, s, rk));
		});
		out.sort(Comparator.comparingDouble(Scored::score).reversed().thenComparingLong(Scored::id));
		return out;
	}
}
