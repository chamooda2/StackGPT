package dev.stackgpt.api.community;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import dev.stackgpt.api.community.Requests.AttemptRequest;
import dev.stackgpt.api.community.Requests.FlagRequest;
import dev.stackgpt.api.community.Requests.SolutionRequest;
import dev.stackgpt.api.community.Requests.VoteRequest;
import dev.stackgpt.api.corpus.Backfill;
import dev.stackgpt.api.extract.ProblemExtractor;
import dev.stackgpt.api.trust.TrustScorer;
import dev.stackgpt.api.verify.Dto.Source;
import dev.stackgpt.api.verify.Dto.SolutionSummary;
import dev.stackgpt.api.verify.VerifyService;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** Reports, votes, flags and user-submitted solutions. Each write returns the solution's updated summary. */
@Service
public class CommunityService {
	static final String USER_SOURCE = "user";
	static final String USER_LICENSE = "user-submitted (StackGPT PoC)";
	private static final TypeReference<List<String>> LIST = new TypeReference<>() {};

	private final JdbcTemplate jdbc;
	private final ObjectMapper json;
	private final SolutionStats stats;
	private final TrustScorer trust;
	private final ProblemExtractor ex;
	private final TransactionTemplate tx;
	private final ObjectProvider<Backfill> backfill;

	public CommunityService(JdbcTemplate jdbc, ObjectMapper json, SolutionStats stats, TrustScorer trust,
			ProblemExtractor ex, TransactionTemplate tx, ObjectProvider<Backfill> backfill) {
		this.jdbc = jdbc;
		this.json = json;
		this.stats = stats;
		this.trust = trust;
		this.ex = ex;
		this.tx = tx;
		this.backfill = backfill;
	}

	public SolutionSummary attempt(long user, AttemptRequest r) {
		requireSolution(r.solutionId());
		jdbc.update("""
				insert into attempts (solution_id, user_id, outcome, env, note) values (?, ?, ?, ?::jsonb, ?)
				on conflict (solution_id, user_id) do update set
				  outcome = excluded.outcome, env = excluded.env, note = excluded.note, created_at = now()""",
				r.solutionId(), user, r.outcome(), json.writeValueAsString(r.env() == null ? Map.of() : r.env()), r.note());
		return summary(r.solutionId(), user);
	}

	public SolutionSummary vote(long user, VoteRequest r) {
		requireSolution(r.solutionId());
		jdbc.update("""
				insert into votes (solution_id, user_id, helpful) values (?, ?, ?)
				on conflict (solution_id, user_id) do update set helpful = excluded.helpful, created_at = now()""",
				r.solutionId(), user, r.helpful());
		return summary(r.solutionId(), user);
	}

	public SolutionSummary flag(long user, FlagRequest r) {
		requireSolution(r.solutionId());
		jdbc.update("insert into flags (solution_id, user_id, kind) values (?, ?, ?) on conflict do nothing",
				r.solutionId(), user, r.kind());
		return summary(r.solutionId(), user);
	}

	/** Stores the solution (and its new problem), then embeds it right away so it is searchable immediately. */
	public SolutionSummary submit(long user, SolutionRequest r) {
		if ((r.problemId() == null) == (r.problem() == null))
			throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "give exactly one of problemId or problem");
		long sid = tx.execute(s -> {
			long pid = r.problemId() != null ? requireProblem(r.problemId()) : newProblem(r.problem().title(), r.problem().body());
			return jdbc.queryForObject("""
					insert into solutions (problem_id, body, steps, code, source, source_id, license)
					values (?, ?, ?::jsonb, ?, ?, ?, ?) returning id""", Long.class,
					pid, r.body(), json.writeValueAsString(r.steps() == null ? List.of() : r.steps()), r.code(),
					USER_SOURCE, UUID.randomUUID().toString(), USER_LICENSE);
		});
		backfill.ifAvailable(Backfill::run);
		return summary(sid, user);
	}

	/** Domain is guessed: a detected device means consumer electronics, anything else programming. */
	long newProblem(String title, String body) {
		var x = ex.extract(title + "\n" + body);
		String domain = x.env().containsKey("device") ? "electronics" : "programming";
		return jdbc.queryForObject("""
				insert into problems (domain, title, body, source, source_id, license)
				values (?, ?, ?, ?, ?, ?) returning id""", Long.class,
				domain, title, body, USER_SOURCE, UUID.randomUUID().toString(), USER_LICENSE);
	}

	public SolutionSummary summary(long id, Long user) {
		record Row(long id, long problemId, String title, String body, List<String> steps, String code, Source src) {}
		var rows = jdbc.query("""
				select s.id, s.problem_id, p.title, s.body, s.steps::text, s.code, s.source, s.source_id, s.source_url, s.author, s.license
				from solutions s join problems p on p.id = s.problem_id where s.id = ?""",
				(rs, i) -> new Row(rs.getLong("id"), rs.getLong("problem_id"), rs.getString("title"), rs.getString("body"),
						json.readValue(rs.getString("steps"), LIST), rs.getString("code"),
						new Source(rs.getString("source"), rs.getString("source_id"), rs.getString("source_url"),
								rs.getString("author"), rs.getString("license"))), id);
		if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "solution " + id + " not found");
		Row s = rows.get(0);
		var st = stats.load(List.of(id), user).get(id);
		return new SolutionSummary(s.id(), s.problemId(), s.title(), s.body(), s.steps(), s.code(), s.src(),
				VerifyService.outcomes(st.attempts()), trust.score(st.attempts(), st.flags(), Instant.now()),
				st.votes(), st.flags(), st.mine());
	}

	private void requireSolution(long id) {
		if (jdbc.queryForObject("select count(*) from solutions where id = ?", Integer.class, id) == 0)
			throw new ResponseStatusException(HttpStatus.NOT_FOUND, "solution " + id + " not found");
	}

	private long requireProblem(long id) {
		if (jdbc.queryForObject("select count(*) from problems where id = ?", Integer.class, id) == 0)
			throw new ResponseStatusException(HttpStatus.NOT_FOUND, "problem " + id + " not found");
		return id;
	}
}
