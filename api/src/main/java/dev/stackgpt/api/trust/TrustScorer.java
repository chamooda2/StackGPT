package dev.stackgpt.api.trust;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import org.springframework.stereotype.Component;

import dev.stackgpt.api.context.ContextMatcher;
import dev.stackgpt.api.context.ContextMatcher.Att;
import dev.stackgpt.api.verify.Dto.Flags;
import dev.stackgpt.api.verify.Dto.Trust;

/**
 * Trust status of a solution from its reports (partial counts as half a success) and flags, checked in order:
 * <ol>
 * <li>unverified: fewer than MIN_REPORTS reports (unless users flagged it outdated)</li>
 * <li>outdated: OUTDATED_FLAGS flags, or worked before but most reports in the last RECENT window failed, or no
 * success for STALE</li>
 * <li>conflicting: within one facet (os, osVer, device, a package version) one segment works and another fails</li>
 * <li>verified: Wilson 95% lower bound of the success rate >= VERIFIED_LOWER and a success within FRESH</li>
 * <li>failing: Wilson upper bound < FAILING_UPPER</li>
 * <li>partial: anything else</li>
 * </ol>
 * Time O(a * f) for a reports and f facets; space O(a).
 */
@Component
public class TrustScorer {
	public static final String UNVERIFIED = "unverified", OUTDATED = "outdated", CONFLICTING = "conflicting",
			VERIFIED = "verified", FAILING = "failing", PARTIAL = "partial";
	static final int MIN_REPORTS = 5, RECENT_MIN = 3, SEGMENT_MIN = 3, OUTDATED_FLAGS = 3, MISLEADING_FLAGS = 3;
	static final double VERIFIED_LOWER = 0.7, FAILING_UPPER = 0.5, RECENT_FAIL = 0.6, OLDER_OK = 0.6, SEG_HI = 0.7, SEG_LO = 0.3;
	static final Duration RECENT = Duration.ofDays(180), FRESH = Duration.ofDays(365), STALE = Duration.ofDays(730);
	static final double Z = 1.96;
	static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("MMM yyyy").withZone(ZoneOffset.UTC);

	public Trust score(List<Att> atts, Flags flags, Instant now) {
		int n = atts.size();
		boolean syn = atts.stream().anyMatch(Att::synthetic);
		List<String> why = new ArrayList<>();
		if (flags != null && flags.misleading() >= MISLEADING_FLAGS) why.add(flags.misleading() + " users flagged this as misleading");
		if (flags != null && flags.outdated() >= OUTDATED_FLAGS)
			return trust(OUTDATED, why, flags.outdated() + " users flagged this as outdated", atts, syn);
		if (n < MIN_REPORTS)
			return trust(UNVERIFIED, why, n == 0 ? "No reports yet" : "Only " + n + (n == 1 ? " report" : " reports") + " so far", atts, syn);

		Instant cut = now.minus(RECENT);
		List<Att> recent = atts.stream().filter(a -> a.at().isAfter(cut)).toList();
		List<Att> older = atts.stream().filter(a -> !a.at().isAfter(cut)).toList();
		long rf = recent.stream().filter(a -> a.outcome().equals("failed")).count();
		if (recent.size() >= RECENT_MIN && (double) rf / recent.size() >= RECENT_FAIL && older.size() >= RECENT_MIN && rate(older) >= OLDER_OK)
			return trust(OUTDATED, why, "Worked before (" + worked(older) + " of " + older.size() + "), but " + rf + " of the last "
					+ recent.size() + " reports failed", atts, syn);
		Instant last = atts.stream().filter(a -> a.outcome().equals("worked")).map(Att::at).max(Instant::compareTo).orElse(null);
		if (last == null || last.isBefore(now.minus(STALE)))
			return trust(OUTDATED, why, last == null ? "No successful report" : "No successful report since " + DAY.format(last), atts, syn);

		String split = conflict(atts);
		if (split != null) return trust(CONFLICTING, why, split, atts, syn);

		double s = successes(atts), lo = wilson(s, n, -1), hi = wilson(s, n, 1);
		String counts = worked(atts) + " of " + n + " reports worked";
		if (lo >= VERIFIED_LOWER && last.isAfter(now.minus(FRESH)))
			return trust(VERIFIED, why, counts + " (at least " + Math.round(lo * 100) + "% with 95% confidence)", atts, syn);
		if (hi < FAILING_UPPER) return trust(FAILING, why, "Only " + counts, atts, syn);
		return trust(PARTIAL, why, "Mixed results: " + counts + ", " + count(atts, "partial") + " partly, " + count(atts, "failed") + " failed", atts, syn);
	}

	/** First facet with a segment that works (>= SEG_HI) and another that fails (<= SEG_LO), as a sentence; else null. */
	static String conflict(List<Att> atts) {
		Map<String, Function<Att, String>> facets = new LinkedHashMap<>();
		facets.put("os", a -> ContextMatcher.str(a.env(), "os"));
		facets.put("osVer", a -> ContextMatcher.str(a.env(), "osVer"));
		facets.put("device", a -> {
			String d = ContextMatcher.str(a.env(), "device");
			return d == null ? null : ContextMatcher.device(d);
		});
		atts.stream().flatMap(a -> ContextMatcher.pkg(a.env()).keySet().stream()).distinct()
				.forEach(p -> facets.put("pkg:" + p, a -> {
					String v = ContextMatcher.pkg(a.env()).get(p);
					return v == null ? null : p + " " + v;
				}));
		for (var f : facets.entrySet()) {
			Map<String, List<Att>> seg = new LinkedHashMap<>();
			Map<String, String> label = new LinkedHashMap<>();
			for (Att a : atts) {
				String k = f.getValue().apply(a);
				if (k == null) continue;
				seg.computeIfAbsent(k, x -> new ArrayList<>()).add(a);
				label.putIfAbsent(k, display(f.getKey(), a));
			}
			String good = null, bad = null;
			for (var e : seg.entrySet()) {
				List<Att> l = e.getValue();
				if (l.size() < SEGMENT_MIN) continue;
				String d = label.get(e.getKey()) + " (" + worked(l) + " of " + l.size() + ")";
				double r = rate(l);
				if (r >= SEG_HI && good == null) good = d;
				if (r <= SEG_LO && bad == null) bad = d;
			}
			if (good != null && bad != null) return "Works on " + good + " but not on " + bad;
		}
		return null;
	}

	static String display(String facet, Att a) {
		if (facet.startsWith("pkg:")) {
			String p = facet.substring(4);
			return p + " " + ContextMatcher.pkg(a.env()).get(p);
		}
		Object v = a.env().get(facet);
		if (facet.equals("osVer")) {
			Object os = a.env().get("os");
			return (os == null ? "" : os + " ") + v;
		}
		return String.valueOf(v);
	}

	/** Wilson score bound for s successes in n trials; sign -1 lower, +1 upper. */
	static double wilson(double s, int n, int sign) {
		if (n == 0) return sign < 0 ? 0 : 1;
		double p = s / n, z2 = Z * Z;
		double c = p + z2 / (2 * n), m = Z * Math.sqrt(p * (1 - p) / n + z2 / (4.0 * n * n));
		return (c + sign * m) / (1 + z2 / n);
	}

	static double successes(List<Att> atts) {
		return worked(atts) + 0.5 * count(atts, "partial");
	}

	static double rate(List<Att> atts) {
		return atts.isEmpty() ? 0 : successes(atts) / atts.size();
	}

	static long worked(List<Att> atts) {
		return count(atts, "worked");
	}

	static long count(List<Att> atts, String outcome) {
		return atts.stream().filter(a -> a.outcome().equals(outcome)).count();
	}

	static Trust trust(String status, List<String> why, String main, List<Att> atts, boolean syn) {
		List<String> reasons = new ArrayList<>();
		reasons.add(main);
		reasons.addAll(why);
		Double lo = atts.isEmpty() ? null : wilson(successes(atts), atts.size(), -1);
		return new Trust(status, reasons, lo, atts.size(), syn);
	}
}
