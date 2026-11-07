package dev.stackgpt.api.verify;

import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import dev.stackgpt.api.align.SolutionAligner;
import dev.stackgpt.api.context.ContextMatcher;
import dev.stackgpt.api.context.ContextMatcher.Att;
import dev.stackgpt.api.context.ContextMatcher.Counts;
import dev.stackgpt.api.embed.Embedder;
import dev.stackgpt.api.extract.Extraction;
import dev.stackgpt.api.extract.ProblemExtractor;
import dev.stackgpt.api.retrieve.Retriever;
import dev.stackgpt.api.retrieve.Rrf;
import dev.stackgpt.api.trust.TrustScorer;
import dev.stackgpt.api.verify.Dto.Alignment;
import dev.stackgpt.api.verify.Dto.Fit;
import dev.stackgpt.api.verify.Dto.Match;
import dev.stackgpt.api.verify.Dto.Outcomes;
import dev.stackgpt.api.verify.Dto.Ranks;
import dev.stackgpt.api.verify.Dto.Solution;
import dev.stackgpt.api.verify.Dto.VerifyRequest;
import dev.stackgpt.api.verify.Dto.VerifyResponse;

/**
 * extract -> embed question (+ answer) -> hybrid retrieve -> RRF fuse -> load candidates
 * -> drop unrelated -> context rerank -> trust per solution -> align answer with stored solutions.
 */
@Service
public class VerifyService {
	static final int CANDIDATES = 20, TOP = 10;
	/**
	 * Below this question/problem similarity a match is unrelated, unless an error signature matched exactly.
	 * Calibrated in VerifyEvalTest: unrelated seeded problems score 0.60-0.67, related ones 0.75+.
	 */
	public static final double MIN_SIM = 0.70;
	/**
	 * Context fit moves the RRF score by at most +-BETA/2. RRF scores are flat (rank 1 vs 5 in one list is ~6%),
	 * so a stronger factor would override relevance instead of reranking near-equals.
	 */
	static final double BETA = 0.2;
	/** Score multiplier for matches with a hard context conflict: still shown (flagged), but below clean ones. */
	static final double CONFLICT_PENALTY = 0.5;

	private final ProblemExtractor ex;
	private final Embedder emb;
	private final Retriever ret;
	private final MatchLoader loader;
	private final ContextMatcher ctx;
	private final SolutionAligner aligner;
	private final TrustScorer trust;

	public VerifyService(ProblemExtractor ex, Embedder emb, Retriever ret, MatchLoader loader, ContextMatcher ctx,
			SolutionAligner aligner, TrustScorer trust) {
		this.ex = ex;
		this.emb = emb;
		this.ret = ret;
		this.loader = loader;
		this.ctx = ctx;
		this.aligner = aligner;
		this.trust = trust;
	}

	/** @param user requesting user (to include their own reports), or null */
	public VerifyResponse verify(VerifyRequest r, Long user) {
		Extraction x = ex.extract(r.question());
		Map<String, Object> env = new LinkedHashMap<>(x.env());
		if (r.envHints() != null) env.putAll(r.envHints());
		float[] q = emb.embed(x.statement());
		String at = SolutionAligner.text(r.answer());
		float[] a = at.isBlank() ? null : emb.embed(at);

		List<Rrf.Scored> hits = Rrf.fuse(ret.search(x.statement(), q, x.errorSigs()).all()).stream().limit(CANDIDATES).toList();
		Map<Long, MatchLoader.Row> rows = loader.load(hits.stream().map(Rrf.Scored::id).toList(), q, a, user);
		Instant now = Instant.now();
		List<Match> ms = hits.stream()
				.map(h -> match(h, rows.get(h.id()), env, now))
				.filter(m -> (m.similarity() != null && m.similarity() >= MIN_SIM) || m.ranks().errorSig() != null)
				.sorted(Comparator.comparingDouble(Match::score).reversed())
				.limit(TOP).toList();
		Alignment al = a == null ? null : aligner.align(ms);
		String status = al == null || al.solutionId() == null || al.verdict().equals(SolutionAligner.NOVEL) ? null
				: ms.stream().flatMap(m -> m.solutions().stream()).filter(s -> s.id() == al.solutionId())
						.map(s -> s.trust().status()).findFirst().orElse(null);
		return new VerifyResponse(new Extraction(x.statement(), x.errorSigs(), env), al, status, ms);
	}

	Match match(Rrf.Scored h, MatchLoader.Row p, Map<String, Object> env, Instant now) {
		var pf = ctx.problem(env, p.env());
		double score = h.score() * (1 + BETA * (pf.score() - ContextMatcher.NEUTRAL)) * (pf.conflicts().isEmpty() ? 1 : CONFLICT_PENALTY);
		List<Solution> sols = p.solutions().stream().map(s -> {
			var sf = ctx.solution(env, s.attempts());
			var st = s.stats();
			return new Solution(s.id(), s.body(), s.steps(), s.code(), s.score(), s.accepted(), s.source(),
					outcomes(s.attempts()), sf.yourEnv() == null ? null : outcomes(sf.yourEnv()), sf.conflicts(),
					s.answerSimilarity(), trust.score(s.attempts(), st.flags(), now), st.votes(), st.flags(), st.mine());
		}).sorted(Comparator.comparing(s -> !s.conflicts().isEmpty())).toList();
		return new Match(p.id(), p.domain(), p.title(), score, p.similarity(),
				new Ranks(rank(h, 0), rank(h, 1), rank(h, 2)), new Fit(pf.score(), pf.conflicts()), p.env(),
				p.errorSigs(), p.source(), sols);
	}

	public static Outcomes outcomes(List<Att> atts) {
		int w = 0, p = 0, f = 0, syn = 0;
		Instant last = null;
		for (Att a : atts) {
			switch (a.outcome()) {
				case "worked" -> w++;
				case "partial" -> p++;
				default -> f++;
			}
			if (a.synthetic()) syn++;
			if (last == null || a.at().isAfter(last)) last = a.at();
		}
		return new Outcomes(w, p, f, syn, last);
	}

	static Outcomes outcomes(Counts c) {
		return new Outcomes(c.worked(), c.partial(), c.failed(), c.synthetic(), null);
	}

	private static Integer rank(Rrf.Scored h, int i) {
		return h.ranks()[i] == 0 ? null : h.ranks()[i];
	}
}
