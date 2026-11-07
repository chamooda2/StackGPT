package dev.stackgpt.api.context;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

/**
 * Fit between the user's environment (query env) and stored problems / solutions.
 *
 * Problem: weighted facet similarity in [0,1] (os 3, device 2, lang 1, osVer 1, each shared pkg 1), shrunk toward
 * NEUTRAL by a prior of weight W_PRIOR so a single weak facet can't produce an extreme fit. An explicit OS mismatch is
 * a hard conflict. "clientOs" (the browser's OS) is only a weak hint: weight 1 and never a conflict. O(f) for f facets.
 *
 * Solution: from its attempts, counts outcomes in setups like the user's, flags OS-specific reports and fixes that
 * mostly fail in the user's setup while working elsewhere. O(a * f) for a attempts.
 */
@Component
public class ContextMatcher {
	public static final double NEUTRAL = 0.5;
	static final double W_OS = 3, W_HINT = 1, W_DEVICE = 2, W_LANG = 1, W_OSVER = 1, W_PKG = 1, W_PRIOR = 2;
	static final int MIN_REPORTS = 5, MIN_SEGMENT = 3;
	static final double DOMINANT = 0.8, MOSTLY = 0.6;

	public record Att(String outcome, boolean synthetic, Map<String, Object> env, Instant at) {}

	public record Counts(int worked, int partial, int failed, int synthetic) {
		public int n() {
			return worked + partial + failed;
		}
	}

	public record ProblemFit(double score, List<String> conflicts) {}

	/** yourEnv is null when no report shares a comparable facet with the user's setup. */
	public record SolutionFit(Counts yourEnv, List<String> conflicts) {}

	static final Set<String> APPLE_MOBILE = Set.of("ios", "ipados");
	static final Map<String, String> OS_LABEL = Map.of("windows", "Windows", "macos", "macOS", "linux", "Linux",
			"ios", "iOS", "ipados", "iPadOS", "android", "Android");
	static final Pattern BRANDS = Pattern.compile("\\b(samsung|google|apple|sony|amazon|nintendo|microsoft|lenovo|dell|hp|philips|bose)\\b");
	static final Pattern PAREN = Pattern.compile("\\(.*?\\)");
	static final Pattern DIGITS = Pattern.compile("\\d+");

	public ProblemFit problem(Map<String, Object> q, Map<String, Object> p) {
		double num = 0, den = 0;
		List<String> conflicts = new ArrayList<>();
		String qos = str(q, "os"), hint = str(q, "clientOs"), pos = str(p, "os");
		if (pos != null && qos != null) {
			double s = osSim(qos, pos);
			num += W_OS * s;
			den += W_OS;
			if (s == 0) conflicts.add("This problem is on " + label(pos) + "; you're on " + label(qos));
			String qv = str(q, "osVer"), pv = str(p, "osVer");
			double vs = s == 1 && qv != null && pv != null ? versionSim(qv, pv) : Double.NaN;
			if (!Double.isNaN(vs)) { num += W_OSVER * vs; den += W_OSVER; }
		} else if (pos != null && hint != null) {
			num += W_HINT * osSim(hint, pos);
			den += W_HINT;
		}
		String qd = str(q, "device"), pd = str(p, "device");
		if (qd != null && pd != null) { num += W_DEVICE * deviceSim(qd, pd); den += W_DEVICE; }
		String ql = str(q, "lang"), pl = str(p, "lang");
		if (ql != null && pl != null) { num += W_LANG * (ql.equals(pl) ? 1 : 0); den += W_LANG; }
		Map<String, String> qp = pkg(q), pp = pkg(p);
		for (var e : qp.entrySet()) {
			String pv = pp.get(e.getKey());
			double vs = pv == null ? Double.NaN : versionSim(e.getValue(), pv);
			if (!Double.isNaN(vs)) { num += W_PKG * vs; den += W_PKG; }
		}
		return new ProblemFit((num + NEUTRAL * W_PRIOR) / (den + W_PRIOR), conflicts);
	}

	public SolutionFit solution(Map<String, Object> q, List<Att> atts) {
		int w = 0, p = 0, f = 0, syn = 0, ow = 0, on = 0, withOs = 0;
		Map<String, Integer> byOs = new HashMap<>();
		for (Att a : atts) {
			String os = str(a.env(), "os");
			if (os != null) { byOs.merge(os, 1, Integer::sum); withOs++; }
			Boolean same = sameSetup(q, a.env());
			if (same == null) continue;
			if (same) {
				switch (a.outcome()) {
					case "worked" -> w++;
					case "partial" -> p++;
					default -> f++;
				}
				if (a.synthetic()) syn++;
			} else {
				on++;
				if (a.outcome().equals("worked")) ow++;
			}
		}
		Counts yours = w + p + f == 0 ? null : new Counts(w, p, f, syn);
		List<String> conflicts = new ArrayList<>();
		String qos = str(q, "os");
		if (qos != null && withOs >= MIN_REPORTS) {
			var top = byOs.entrySet().stream().max(Map.Entry.comparingByValue()).orElseThrow();
			if ((double) top.getValue() / withOs >= DOMINANT && osSim(qos, top.getKey()) == 0)
				conflicts.add("Reports for this fix come from " + label(top.getKey()) + "; you're on " + label(qos));
		}
		if (yours != null && yours.n() >= MIN_SEGMENT && (double) f / yours.n() >= MOSTLY
				&& on >= MIN_SEGMENT && (double) ow / on >= MOSTLY)
			conflicts.add("Mostly fails in setups like yours (" + describe(q) + ") but works in others");
		return new SolutionFit(yours, conflicts);
	}

	/** True when every facet both sides have matches, false on any mismatch, null when nothing is comparable. */
	static Boolean sameSetup(Map<String, Object> q, Map<String, Object> a) {
		int compared = 0;
		String qos = str(q, "os"), aos = str(a, "os");
		if (qos != null && aos != null) {
			if (osSim(qos, aos) < 1) return false;
			compared++;
			String qv = str(q, "osVer"), av = str(a, "osVer");
			if (qv != null && av != null) {
				Boolean eq = sameVersion(qv, av);
				if (eq != null) { if (!eq) return false; compared++; }
			}
		}
		String qd = str(q, "device"), ad = str(a, "device");
		if (qd != null && ad != null) {
			if (!device(qd).equals(device(ad))) return false;
			compared++;
		}
		Map<String, String> ap = pkg(a);
		for (var e : pkg(q).entrySet()) {
			String av = ap.get(e.getKey());
			Boolean eq = av == null ? null : sameVersion(e.getValue(), av);
			if (eq != null) { if (!eq) return false; compared++; }
		}
		return compared == 0 ? null : true;
	}

	static String describe(Map<String, Object> q) {
		Object d = q.get("device");
		if (d != null) return d.toString();
		List<String> parts = new ArrayList<>();
		String os = str(q, "os");
		if (os != null) parts.add(label(os) + (q.get("osVer") == null ? "" : " " + q.get("osVer")));
		pkg(q).forEach((k, v) -> parts.add(k + " " + v));
		return String.join(", ", parts);
	}

	static double osSim(String a, String b) {
		if (a.equals(b)) return 1;
		return APPLE_MOBILE.contains(a) && APPLE_MOBILE.contains(b) ? 0.5 : 0;
	}

	/** Lowercase, without brand names and parentheticals: "Samsung Galaxy A14 (4G)" -> "galaxy a14". */
	public static String device(String d) {
		String s = PAREN.matcher(d.toLowerCase(Locale.ROOT)).replaceAll(" ");
		return BRANDS.matcher(s).replaceAll(" ").replaceAll("\\s+", " ").trim();
	}

	/** 1 same model, 0.75 one name is a less specific prefix ("airpods" / "airpods pro"), 0.5 same family, else 0. */
	static double deviceSim(String a, String b) {
		String x = device(a), y = device(b);
		if (x.equals(y)) return 1;
		if (x.startsWith(y + " ") || y.startsWith(x + " ")) return 0.75;
		return !x.isEmpty() && x.split(" ")[0].equals(y.split(" ")[0]) ? 0.5 : 0;
	}

	/** 0 on different major, else 1 / (1 + minor distance); NaN when either has no number. */
	static double versionSim(String a, String b) {
		int[] x = ver(a), y = ver(b);
		if (x.length == 0 || y.length == 0) return Double.NaN;
		if (x[0] != y[0]) return 0;
		int mx = x.length > 1 ? x[1] : 0, my = y.length > 1 ? y[1] : 0;
		return 1.0 / (1 + Math.abs(mx - my));
	}

	/** Equal on the components both specify ("14" == "14.1", "11 23H2" != "11 24H2"); null when not comparable. */
	static Boolean sameVersion(String a, String b) {
		int[] x = ver(a), y = ver(b);
		if (x.length == 0 || y.length == 0) return null;
		for (int i = 0; i < Math.min(x.length, y.length); i++) if (x[i] != y[i]) return false;
		return true;
	}

	static int[] ver(String v) {
		Matcher m = DIGITS.matcher(v);
		List<Integer> l = new ArrayList<>();
		while (m.find() && l.size() < 4) l.add(Integer.parseInt(m.group()));
		return l.stream().mapToInt(Integer::intValue).toArray();
	}

	public static String str(Map<String, ?> m, String k) {
		Object v = m == null ? null : m.get(k);
		if (v == null) return null;
		String s = v.toString().trim().toLowerCase(Locale.ROOT);
		return s.isEmpty() ? null : s;
	}

	public static Map<String, String> pkg(Map<String, ?> m) {
		Object v = m == null ? null : m.get("pkg");
		if (!(v instanceof Map<?, ?> p)) return Map.of();
		Map<String, String> o = new HashMap<>();
		p.forEach((k, x) -> { if (x != null) o.put(k.toString().toLowerCase(Locale.ROOT), x.toString()); });
		return o;
	}

	static String label(String os) {
		return OS_LABEL.getOrDefault(os, os);
	}
}
