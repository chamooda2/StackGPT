package dev.stackgpt.api.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.sql.DriverManager;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import dev.stackgpt.api.align.SolutionAligner;
import dev.stackgpt.api.community.Requests.AttemptRequest;
import dev.stackgpt.api.community.Requests.FlagRequest;
import dev.stackgpt.api.community.Requests.NewProblem;
import dev.stackgpt.api.community.Requests.SolutionRequest;
import dev.stackgpt.api.community.Requests.VoteRequest;
import dev.stackgpt.api.context.ContextMatcher;
import dev.stackgpt.api.corpus.Backfill;
import dev.stackgpt.api.embed.LocalEmbedder;
import dev.stackgpt.api.extract.RuleExtractor;
import dev.stackgpt.api.retrieve.Retriever;
import dev.stackgpt.api.trust.TrustScorer;
import dev.stackgpt.api.verify.Dto.Answer;
import dev.stackgpt.api.verify.Dto.VerifyRequest;
import dev.stackgpt.api.verify.MatchLoader;
import dev.stackgpt.api.verify.VerifyService;
import tools.jackson.databind.json.JsonMapper;

/**
 * Community writes against the seeded DB (docker compose db on :5433), all inside one transaction that is rolled
 * back, so the dev DB is left untouched. Skipped when the DB is unavailable.
 */
class CommunityEvalTest {
	static final String URL = "jdbc:postgresql://localhost:5433/stackgpt";
	static final String TOKEN = "eval-" + "x".repeat(40);
	static DriverManagerDataSource ds;

	@BeforeAll
	static void db() {
		try (var c = DriverManager.getConnection(URL, "stackgpt", "stackgpt")) {
			assumeTrue(c.isValid(2));
		} catch (Exception e) {
			assumeTrue(false, "DB not reachable: " + e.getMessage());
		}
		ds = new DriverManagerDataSource(URL, "stackgpt", "stackgpt");
	}

	@Test
	void reportsVotesFlagsAndSubmissionsRoundTrip() {
		var jdbc = new JdbcTemplate(ds);
		var json = JsonMapper.builder().build();
		var tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
		var ex = new RuleExtractor();
		var emb = new LocalEmbedder();
		var stats = new SolutionStats(jdbc, json);
		var backfill = new StaticListableBeanFactory(Map.of("backfill", new Backfill(jdbc, emb, ex, json))).getBeanProvider(Backfill.class);
		var svc = new CommunityService(jdbc, json, stats, new TrustScorer(), ex, tx, backfill);
		var verify = new VerifyService(ex, emb, new Retriever(jdbc), new MatchLoader(jdbc, json, stats), new ContextMatcher(),
				new SolutionAligner(), new TrustScorer());
		var users = new Users(jdbc);

		tx.executeWithoutResult(status -> {
			long user = users.require(TOKEN);
			assertThat(users.find(TOKEN)).isEqualTo(user);
			long sol = jdbc.queryForObject("select id from solutions where source_id = 'py-002-s1'", Long.class);

			var s = svc.attempt(user, new AttemptRequest(sol, "worked", Map.of("os", "linux"), null));
			assertThat(s.outcomes().worked()).isEqualTo(20);
			assertThat(s.outcomes().synthetic()).isEqualTo(20); // the new real report is not synthetic
			assertThat(s.mine().outcome()).isEqualTo("worked");
			assertThat(s.trust().status()).isEqualTo("verified");

			s = svc.attempt(user, new AttemptRequest(sol, "failed", Map.of("os", "linux"), "still errors in a venv"));
			assertThat(List.of(s.outcomes().worked(), s.outcomes().failed())).containsExactly(19, 1); // replaced, not added
			assertThat(s.mine().outcome()).isEqualTo("failed");

			s = svc.vote(user, new VoteRequest(sol, true));
			assertThat(s.votes().helpful()).isEqualTo(1);
			assertThat(s.mine().helpful()).isTrue();
			s = svc.vote(user, new VoteRequest(sol, false));
			assertThat(List.of(s.votes().helpful(), s.votes().notHelpful())).containsExactly(0, 1);

			svc.flag(user, new FlagRequest(sol, "outdated"));
			s = svc.flag(user, new FlagRequest(sol, "outdated"));
			assertThat(s.flags().outdated()).isEqualTo(1);
			assertThat(s.mine().flags()).containsExactly("outdated");

			assertThat(svc.summary(sol, null).mine().outcome()).isNull(); // anonymous read

			// A novel answer shared as a new fix becomes searchable and alignable immediately.
			String q = "Logitech MX Master 3S horizontal scroll wheel stops working only in Chrome on Windows 11";
			var created = svc.submit(user, new SolutionRequest(null, new NewProblem(q, q),
					"Turn off 'Smooth scrolling' in chrome://flags and restart Chrome; Logi Options+ app-specific settings for Chrome also override it.",
					List.of("Open chrome://flags", "Disable Smooth Scrolling", "Restart Chrome"), null));
			assertThat(created.problemTitle()).isEqualTo(q);
			assertThat(created.trust().status()).isEqualTo("unverified");
			assertThat(jdbc.queryForObject("select embedding is not null from solutions where id = ?", Boolean.class, created.id())).isTrue();
			svc.attempt(user, new AttemptRequest(created.id(), "worked", Map.of(), null));

			var r = verify.verify(new VerifyRequest("chatgpt", q,
					new Answer("", List.of(), List.of("Open chrome://flags", "Disable Smooth Scrolling", "Restart Chrome")), Map.of()), user);
			assertThat(r.matches().get(0).problemId()).isEqualTo(created.problemId());
			assertThat(r.alignment().verdict()).isEqualTo("matches");
			assertThat(r.alignment().solutionId()).isEqualTo(created.id());
			assertThat(r.trustStatus()).isEqualTo("unverified");
			assertThat(r.matches().get(0).solutions().get(0).mine().outcome()).isEqualTo("worked");

			assertThatThrownBy(() -> svc.submit(user, new SolutionRequest(1L, new NewProblem("t", "b"), "x", null, null)))
					.isInstanceOf(ResponseStatusException.class).hasMessageContaining("exactly one");
			assertThatThrownBy(() -> svc.attempt(user, new AttemptRequest(-1L, "worked", null, null)))
					.isInstanceOf(ResponseStatusException.class).hasMessageContaining("not found");

			status.setRollbackOnly();
		});
		assertThat(users.find(TOKEN)).isNull();
	}
}
