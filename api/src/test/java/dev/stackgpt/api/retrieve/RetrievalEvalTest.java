package dev.stackgpt.api.retrieve;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import dev.stackgpt.api.embed.LocalEmbedder;
import dev.stackgpt.api.extract.RuleExtractor;

/**
 * End-to-end retrieval quality on the seeded, backfilled DB (docker compose db on :5433).
 * Paraphrased user questions must find their curated problem in the top 3. Skipped when the DB is unavailable.
 */
public class RetrievalEvalTest {
	static final String URL = "jdbc:postgresql://localhost:5433/stackgpt";
	static JdbcTemplate jdbc;

	public record Case(String question, String expected) {}

	public static final List<Case> CASES = List.of(
			new Case("I'm on Ubuntu 24.04 and pip install requests gives error: externally-managed-environment. How do I fix it?", "py-002"),
			new Case("node server won't start: Error: listen EADDRINUSE: address already in use :::8080", "js-002"),
			new Case("My AirPods only play sound in the left ear, the right one is silent", "au-01"),
			new Case("Windows update KB5034441 keeps failing with 0x80070643", "pc-06"),
			new Case("git pull says fatal: refusing to merge unrelated histories", "gt-001"),
			new Case("My M2 MacBook Air won't show anything on the second external monitor, only one works", "pc-03"),
			new Case("Docker image built on my Apple Silicon Mac fails on the server with exec format error", "dk-003"),
			new Case("Canon printer shows support code 1688 after I refilled the ink", "pr-03"),
			new Case("import pandas crashes: A module that was compiled using NumPy 1.x cannot be run in NumPy 2.0", "py-003"),
			new Case("Google Home says my Chromecast is an untrusted device and I can't cast anymore", "nw-08"),
			new Case("Samsung phone keeps saying moisture detected in the charging port but it's completely dry", "ph-02"),
			new Case("how do I get my Python script to stop failing with ModuleNotFoundError for requests in VS Code", "py-001"));

	@BeforeAll
	static void db() {
		try (var c = DriverManager.getConnection(URL, "stackgpt", "stackgpt")) {
			var rs = c.createStatement().executeQuery("select count(*) from problems where embedding is null");
			rs.next();
			assumeTrue(rs.getLong(1) == 0, "problems not backfilled; start the API once first");
		} catch (Exception e) {
			assumeTrue(false, "DB not reachable: " + e.getMessage());
		}
		jdbc = new JdbcTemplate(new DriverManagerDataSource(URL, "stackgpt", "stackgpt"));
	}

	@Test
	void paraphrasedQuestionsFindTheirProblem() {
		var ex = new RuleExtractor();
		var emb = new LocalEmbedder();
		var ret = new Retriever(jdbc);
		List<String> misses = new ArrayList<>();
		int top1 = 0;
		for (Case c : CASES) {
			var x = ex.extract(c.question());
			var fused = Rrf.fuse(ret.search(x.statement(), emb.embed(x.statement()), x.errorSigs()).all());
			List<String> top = fused.stream().limit(3)
					.map(s -> jdbc.queryForObject("select source_id from problems where id = ?", String.class, s.id())).toList();
			int rank = top.indexOf(c.expected()) + 1;
			if (rank == 1) top1++;
			System.out.printf("%-6s rank=%s top3=%s%n", c.expected(), rank == 0 ? "-" : rank, top);
			if (rank == 0) misses.add(c.expected() + " -> " + top);
		}
		System.out.printf("hit@1 %d/%d, hit@3 %d/%d%n", top1, CASES.size(), CASES.size() - misses.size(), CASES.size());
		assertThat(misses).as("expected problem not in top 3").isEmpty();
	}
}
