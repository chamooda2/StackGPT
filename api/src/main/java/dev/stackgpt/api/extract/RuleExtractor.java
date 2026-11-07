package dev.stackgpt.api.extract;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

/**
 * Regex-based extractor. Time O(P * L) for P patterns over text length L; space O(L).
 * Error signatures are lowercased and normalized (paths, URLs, dotted names, numbers masked;
 * message cut at its first ": " clause) so the same error from different users compares equal.
 */
@Component
public class RuleExtractor implements ProblemExtractor {
	static final int MAX_STATEMENT = 4000, MAX_SIGS = 10, MAX_SIG = 100;

	// "ModuleNotFoundError: No module named 'x'" -> type + first message clause
	static final Pattern EXC = Pattern.compile("\\b([A-Z][A-Za-z0-9]*(?:Error|Exception))(?::[ \\t]*([^\\n]*))?");
	static final Pattern ERRNO = Pattern.compile("\\b(E(?:ACCES|ADDRINUSE|ADDRNOTAVAIL|CONNABORTED|CONNREFUSED|CONNRESET|EXIST"
			+ "|HOSTUNREACH|INTEGRITY|ISDIR|MFILE|NOENT|NOSPC|NOTDIR|NOTEMPTY|NOTFOUND|PERM|PIPE|RESOLVE|TIMEDOUT))\\b");
	static final Pattern ERR_CODE = Pattern.compile("\\b(ERR_[A-Z0-9_]{3,})\\b");
	static final Pattern HEX = Pattern.compile("\\b(0x[0-9A-Fa-f]{8})\\b");
	static final Pattern OPENSSL = Pattern.compile("\\berror:([0-9A-F]{8}):");
	// pip-style codes: "error: externally-managed-environment", on its own line or inline
	static final Pattern SLUG = Pattern.compile("(?i)\\berror:\\s+([a-z]+(?:-[a-z]+)+)\\b");
	static final Pattern FATAL = Pattern.compile("(?m)^\\s*fatal: ([^\\n]+)$");
	static final Pattern DEV_CODE = Pattern.compile("\\(Code (\\d{1,3})\\)");
	static final Pattern SUPPORT = Pattern.compile("(?i)\\bsupport code:? (\\d{3,4})\\b");
	static final Pattern DASH_CODE = Pattern.compile("\\b(\\d{4}-\\d{4}|[A-Z]{2,4}-\\d{1,3}-\\d{1,3})\\b");

	static final Pattern URL = Pattern.compile("['\"]?https?://[^\\s'\"]+['\"]?");
	static final Pattern PATH = Pattern.compile("['\"]?[^\\s'\"]*[/\\\\][^\\s'\"]*['\"]?");
	static final Pattern DOTTED = Pattern.compile("\\b[\\w$]+(?:\\.[\\w$]+){2,}\\b");
	static final Pattern NUM = Pattern.compile("\\b\\d+\\b");
	static final Pattern WS = Pattern.compile("\\s+");

	static final Map<String, Pattern> OS = ordered(
			"windows", "(?i)\\b(windows|win1[01]|powershell|cmd\\.exe|wsl2?)\\b|\\b[A-Za-z]:\\\\",
			"macos", "(?i)\\b(macos|mac ?os ?x?|osx|macbook|imac|mac mini|homebrew|brew install)\\b|/Users/",
			"linux", "(?i)\\b(linux|ubuntu|debian|fedora|centos|apt|apt-get|systemd)\\b|/home/",
			"ios", "(?i)\\b(ios|iphone)\\b",
			"ipados", "(?i)\\b(ipados|ipad)\\b",
			"android", "(?i)\\b(android|galaxy|one ?ui)\\b|\\bPixel \\d");
	static final Map<String, Pattern> OS_VER = ordered(
			"windows", "(?i)\\b(?:windows |win)(1[01])\\b",
			"macos", "(?i)\\bmacos (1\\d|2\\d)\\b",
			"linux", "(?i)\\b((?:ubuntu|debian|fedora) \\d+(?:\\.\\d+)?)\\b",
			"ios", "(?i)\\bios (\\d{1,2})\\b",
			"ipados", "(?i)\\bipados (\\d{1,2})\\b",
			"android", "(?i)\\bandroid (\\d{1,2})\\b");
	static final Pattern WIN_BUILD = Pattern.compile("\\b(2\\dH[12])\\b");
	static final Map<String, Pattern> LANG = ordered(
			"python", "(?i)\\b(python3?|pip3?|django|flask|numpy|pandas|traceback|\\w+\\.py)\\b",
			"javascript", "(?i)\\b(node(?:\\.js)?|npm|npx|yarn|pnpm|javascript|react|express|webpack|vite|\\w+\\.m?js)\\b",
			"typescript", "(?i)\\b(typescript|tsc|\\w+\\.tsx?)\\b",
			"java", "(?i)\\b(java|jdk|jvm|maven|gradle|spring|lombok|\\w+\\.jar)\\b");
	static final Pattern PKG = Pattern.compile("(?i)\\b(python|node(?:\\.js)?|java|jdk|npm|django|react|react-scripts|numpy|pandas"
			+ "|spring[ -]boot|lombok|docker|git|maven|webpack)(?:\\s+v?|@|==)(\\d+(?:\\.\\d+){0,2})\\b");
	static final Pattern DEVICE = Pattern.compile("(?i)\\b(iPhone (?:\\d{1,2}|SE|X[RS]?)(?: Pro(?: Max)?| Plus| mini)?"
			+ "|iPad(?: Air| Pro| mini)?|(?:Samsung )?Galaxy (?:[SAZ]\\d{1,2}\\w*|Buds\\s?\\d?(?: Pro| FE)?|Tab S\\d+\\w*|Watch\\s?\\d*)"
			+ "|(?:Google )?Pixel \\d{1,2}\\w*(?: Pro)?|MacBook (?:Air|Pro)(?: M\\d(?: Pro| Max)?)?|AirPods(?: Pro| Max)?"
			+ "|ThinkPad \\w+|XPS \\d+|Sony WH-\\w+|PlayStation \\d|PS[45]|Nintendo Switch|Xbox(?: Series [XS]| Wireless Controller)?"
			+ "|Chromecast|Echo Dot|Kindle(?: Paperwhite)?|Fire TV Stick(?: 4K)?|Roku|Sonos \\w+|Apple Watch(?: Series \\d+| Ultra)?)\\b");

	@Override
	public Extraction extract(String text) {
		String t = text == null ? "" : text;
		String st = WS.matcher(t).replaceAll(" ").trim();
		if (st.length() > MAX_STATEMENT) st = st.substring(0, MAX_STATEMENT);
		return new Extraction(st, sigs(t), env(t));
	}

	static List<String> sigs(String t) {
		Set<String> s = new LinkedHashSet<>();
		Matcher m = EXC.matcher(t);
		while (m.find()) {
			String type = m.group(1).toLowerCase(Locale.ROOT), msg = m.group(2) == null ? "" : norm(m.group(2));
			if (!msg.isEmpty()) s.add(cap(type + ": " + msg));
			s.add(type);
		}
		all(ERRNO, t, s, x -> x.toLowerCase(Locale.ROOT));
		all(ERR_CODE, t, s, x -> x.toLowerCase(Locale.ROOT));
		all(HEX, t, s, x -> x.toLowerCase(Locale.ROOT));
		all(OPENSSL, t, s, x -> "error:" + x.toLowerCase(Locale.ROOT));
		all(SLUG, t, s, x -> x.toLowerCase(Locale.ROOT));
		all(FATAL, t, s, x -> cap("fatal: " + norm(x)));
		all(DEV_CODE, t, s, x -> "code " + x);
		all(SUPPORT, t, s, x -> "support code " + x);
		all(DASH_CODE, t, s, x -> x.toLowerCase(Locale.ROOT));
		return s.stream().limit(MAX_SIGS).toList();
	}

	static Map<String, Object> env(String t) {
		Map<String, Object> e = new LinkedHashMap<>();
		String os = best(OS, t);
		if (os != null) {
			e.put("os", os);
			Matcher v = OS_VER.get(os).matcher(t);
			if (v.find()) {
				String ver = v.group(1).toLowerCase(Locale.ROOT);
				Matcher b = WIN_BUILD.matcher(t);
				e.put("osVer", os.equals("windows") && b.find() ? ver + " " + b.group(1).toUpperCase(Locale.ROOT) : ver);
			}
		}
		String lang = best(LANG, t);
		if (lang != null) e.put("lang", lang);
		Map<String, String> pkg = new LinkedHashMap<>();
		Matcher p = PKG.matcher(t);
		while (p.find()) pkg.putIfAbsent(pkgName(p.group(1)), p.group(2));
		if (!pkg.isEmpty()) e.put("pkg", pkg);
		Matcher d = DEVICE.matcher(t);
		if (d.find()) e.put("device", d.group(1));
		return e;
	}

	/** Lowercase, mask variable parts, keep the first ": " clause, collapse whitespace. */
	static String norm(String s) {
		s = s.toLowerCase(Locale.ROOT);
		s = URL.matcher(s).replaceAll("<url>");
		s = PATH.matcher(s).replaceAll("<path>");
		s = DOTTED.matcher(s).replaceAll("<name>");
		s = NUM.matcher(s).replaceAll("#");
		int c = s.indexOf(": ");
		if (c >= 0) s = s.substring(0, c);
		return WS.matcher(s).replaceAll(" ").trim();
	}

	static String cap(String s) {
		return s.length() > MAX_SIG ? s.substring(0, MAX_SIG) : s;
	}

	static void all(Pattern p, String t, Set<String> out, Function<String, String> f) {
		Matcher m = p.matcher(t);
		while (m.find()) out.add(f.apply(m.group(1)));
	}

	/** Key with the most pattern hits; null when none or tied. */
	static String best(Map<String, Pattern> ps, String t) {
		String top = null;
		int max = 0;
		boolean tie = false;
		for (var en : ps.entrySet()) {
			int n = (int) en.getValue().matcher(t).results().count();
			if (n > max) { top = en.getKey(); max = n; tie = false; }
			else if (n == max && n > 0) tie = true;
		}
		return tie ? null : top;
	}

	static String pkgName(String n) {
		String s = n.toLowerCase(Locale.ROOT).replace(' ', '-');
		return switch (s) {
			case "node.js" -> "node";
			case "jdk" -> "java";
			default -> s;
		};
	}

	static Map<String, Pattern> ordered(String... kv) {
		Map<String, Pattern> m = new LinkedHashMap<>();
		for (int i = 0; i < kv.length; i += 2) m.put(kv[i], Pattern.compile(kv[i + 1]));
		return m;
	}
}
