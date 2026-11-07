package dev.stackgpt.api.verify;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import dev.stackgpt.api.align.SolutionAligner;
import dev.stackgpt.api.context.ContextMatcher;
import dev.stackgpt.api.embed.LocalEmbedder;
import dev.stackgpt.api.extract.RuleExtractor;
import dev.stackgpt.api.retrieve.RetrievalEvalTest;
import dev.stackgpt.api.retrieve.Retriever;
import dev.stackgpt.api.verify.Dto.Answer;
import dev.stackgpt.api.verify.Dto.CodeBlock;
import dev.stackgpt.api.verify.Dto.Match;
import dev.stackgpt.api.verify.Dto.VerifyRequest;
import dev.stackgpt.api.verify.Dto.VerifyResponse;
import tools.jackson.databind.json.JsonMapper;

/**
 * Full /v1/verify pipeline on the seeded, backfilled DB (docker compose db on :5433): relevance cutoff, context
 * conflicts and answer alignment. Also the calibration record for MIN_SIM and the aligner thresholds: run it and
 * read the printed similarities. Skipped when the DB is unavailable.
 */
class VerifyEvalTest {
	static final String URL = "jdbc:postgresql://localhost:5433/stackgpt";
	static JdbcTemplate jdbc;
	static VerifyService svc;

	@BeforeAll
	static void setUp() {
		try (var c = DriverManager.getConnection(URL, "stackgpt", "stackgpt")) {
			var rs = c.createStatement().executeQuery("select count(*) from problems where embedding is null");
			rs.next();
			assumeTrue(rs.getLong(1) == 0, "problems not backfilled; start the API once first");
		} catch (Exception e) {
			assumeTrue(false, "DB not reachable: " + e.getMessage());
		}
		jdbc = new JdbcTemplate(new DriverManagerDataSource(URL, "stackgpt", "stackgpt"));
		svc = new VerifyService(new RuleExtractor(), new LocalEmbedder(), new Retriever(jdbc),
				new MatchLoader(jdbc, JsonMapper.builder().build()), new ContextMatcher(), new SolutionAligner());
	}

	static VerifyResponse run(String q, Answer a) {
		return svc.verify(new VerifyRequest("chatgpt", q, a, Map.of("clientOs", "windows")));
	}

	static String sid(Long problemOrSolutionId, String table) {
		return problemOrSolutionId == null ? null
				: jdbc.queryForObject("select source_id from " + table + " where id = ?", String.class, problemOrSolutionId);
	}

	static void print(String label, VerifyResponse r) {
		var al = r.alignment();
		System.out.printf("%n== %s%n alignment: %s sol=%s sim=%s%n", label, al == null ? "-" : al.verdict(),
				al == null ? "-" : sid(al.solutionId(), "solutions"), al == null || al.similarity() == null ? "-" : "%.3f".formatted(al.similarity()));
		for (Match m : r.matches().stream().limit(3).toList())
			System.out.printf(" %-6s score=%.4f sim=%.3f fit=%.2f %s | sols: %s%n", m.source().id(), m.score(), m.similarity(),
					m.fit().score(), m.fit().conflicts(), m.solutions().stream()
							.map(s -> "%s ans=%s your=%s %s".formatted(s.source().id(),
									s.answerSimilarity() == null ? "-" : "%.3f".formatted(s.answerSimilarity()),
									s.yourEnv() == null ? "-" : s.yourEnv().worked() + "/" + s.yourEnv().partial() + "/" + s.yourEnv().failed(),
									s.conflicts()))
							.collect(Collectors.joining("; ")));
	}

	static Answer code(String steps, String code) {
		return new Answer("", List.of(new CodeBlock("bash", code, true)), List.of(steps.split("\\|")));
	}

	static Answer prose(String p) {
		return new Answer(p, List.of(), List.of());
	}

	// ---- alignment ----

	@Test
	void venvAnswerMatchesTheVerifiedSolution() {
		var r = run("pip install fails on Ubuntu 24.04 with error: externally-managed-environment",
				code("Install the venv module|Create a virtual environment|Activate it|Install your package inside the venv",
						"sudo apt install python3-venv\npython3 -m venv .venv\nsource .venv/bin/activate\npip install requests"));
		print("venv answer", r);
		assertThat(r.alignment().verdict()).isEqualTo("matches");
		assertThat(sid(r.alignment().solutionId(), "solutions")).isEqualTo("py-002-s1");
	}

	@Test
	void breakSystemPackagesAnswerAlignsWithTheRiskyAlternative() {
		var r = run("pip install fails on Ubuntu 24.04 with error: externally-managed-environment",
				code("Override the protection with --break-system-packages", "pip install --break-system-packages requests"));
		print("--break-system-packages answer", r);
		assertThat(sid(r.alignment().solutionId(), "solutions")).isEqualTo("py-002-s2");
		assertThat(r.alignment().verdict()).isIn("matches", "partial");
	}

	@Test
	void differentFixIsNotAMatch() {
		var r = run("pip install fails on Ubuntu 24.04 with error: externally-managed-environment",
				code("Install Miniconda|Create a conda environment|Install the package with conda",
						"wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh\nbash Miniconda3-latest-Linux-x86_64.sh\nconda create -n app python=3.12\nconda activate app\nconda install requests"));
		print("conda answer", r);
		assertThat(r.alignment().verdict()).isNotEqualTo("matches");
	}

	@Test
	void windowsPortAnswerMatchesTheWindowsSolution() {
		var r = run("npm run dev on Windows 11 fails: Error: listen EADDRINUSE: address already in use :::3000",
				code("Find the process using port 3000|Kill it by PID", "netstat -ano | findstr :3000\ntaskkill /PID 12345 /F"));
		print("taskkill answer", r);
		assertThat(r.alignment().verdict()).isEqualTo("matches");
		assertThat(sid(r.alignment().solutionId(), "solutions")).isEqualTo("js-002-s1");
	}

	@Test
	void proseOnlyElectronicsAnswer() {
		var r = run("My AirPods only play sound in the left ear, the right one is silent",
				prose("""
						Try resetting your AirPods. Put both AirPods in the charging case and close the lid for 30 seconds.
						Then forget the AirPods in your phone's Bluetooth settings. Open the lid and press and hold the setup
						button on the back of the case for about 15 seconds until the status light flashes amber, then white.
						Reconnect them to your device. If one side is still silent, gently clean the speaker mesh with a dry brush."""));
		print("airpods reset (prose)", r);
		assertThat(r.matches().get(0).source().id()).isEqualTo("au-01");
		assertThat(sid(r.alignment().problemId(), "problems")).isEqualTo("au-01");
		assertThat(r.alignment().verdict()).isIn("matches", "partial");
	}

	// ---- context ----

	@Test
	void modelSpecificFixIsFlaggedForTheUsersDevice() {
		var r = run("My Samsung Galaxy A14 won't super fast charge with the 25W charger on Android 14",
				prose("Go to Settings > Battery > Charging settings and enable Fast charging and Super fast charging."));
		print("Galaxy A14", r);
		Match top = r.matches().get(0);
		assertThat(top.source().id()).isEqualTo("ph-03");
		var s = top.solutions().get(0);
		assertThat(s.yourEnv().failed()).isEqualTo(8);
		assertThat(s.conflicts()).anyMatch(c -> c.startsWith("Mostly fails in setups like yours"));
	}

	@Test
	void osSpecificSolutionIsFlaggedAndSortedLast() {
		var r = run("On macOS, npm start fails with Error: listen EADDRINUSE: address already in use :::3000", null);
		print("EADDRINUSE on macOS", r);
		Match js = r.matches().stream().filter(m -> m.source().id().equals("js-002")).findFirst().orElseThrow();
		assertThat(js.solutions()).extracting(s -> s.source().id()).containsExactly("js-002-s2", "js-002-s1");
		assertThat(js.solutions().get(1).conflicts()).containsExactly("Reports for this fix come from Windows; you're on macOS");
		assertThat(r.alignment()).isNull();
	}

	@Test
	void problemOnAnotherOsIsDemoted() {
		var r = run("Python on Windows 11: ssl.SSLCertVerificationError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed",
				prose("Install certifi and point SSL_CERT_FILE at its bundle."));
		print("SSL on Windows", r);
		Match py4 = r.matches().stream().filter(m -> m.source().id().equals("py-004")).findFirst().orElseThrow();
		assertThat(py4.fit().conflicts()).containsExactly("This problem is on macOS; you're on Windows");
	}

	// ---- relevance ----

	@Test
	void retrievalCasesSurviveCutoffAndRerank() {
		int top1 = 0;
		for (var c : RetrievalEvalTest.CASES) {
			var ids = run(c.question(), null).matches().stream().limit(3).map(m -> m.source().id()).toList();
			System.out.printf("%-6s top3=%s%n", c.expected(), ids);
			assertThat(ids).as(c.question()).contains(c.expected());
			if (ids.get(0).equals(c.expected())) top1++;
		}
		System.out.printf("full pipeline hit@1 %d/%d%n", top1, RetrievalEvalTest.CASES.size());
	}

	@Test
	void unrelatedQuestionHasNoMatches() {
		var r = run("What's a good recipe for banana bread?",
				prose("Mash 3 ripe bananas, mix with melted butter, sugar, an egg, vanilla, baking soda and flour. Bake at 175C for 60 minutes."));
		print("banana bread", r);
		assertThat(r.matches()).isEmpty();
		assertThat(r.alignment().verdict()).isEqualTo("novel");
	}
}
