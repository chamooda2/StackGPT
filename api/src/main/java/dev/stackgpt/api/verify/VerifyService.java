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
import dev.stackgpt.api.verify.Dto.Fit;
import dev.stackgpt.api.verify.Dto.Match;
import dev.stackgpt.api.verify.Dto.Outcomes;
import dev.stackgpt.api.verify.Dto.Ranks;
import dev.stackgpt.api.verify.Dto.Solution;
import dev.stackgpt.api.verify.Dto.VerifyRequest;
import dev.stackgpt.api.verify.Dto.VerifyResponse;

/**
 * extract -> embed question (+ answer) -> hybrid retrieve -> RRF fuse -> load candidates
 * -> drop unrelated -> context rerank -> align answer with stored solutions.
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

	public VerifyService(ProblemExtractor ex, Embedder emb, Retriever ret, MatchLoader loader, ContextMatcher ctx,
			SolutionAligner aligner) {
		this.ex = ex;
		this.emb = emb;
		this.ret = ret;
		this.loader = loader;
		this.ctx = ctx;
		this.aligner = aligner;
	}

	public VerifyResponse verify(VerifyRequest r) {
		Extraction x = ex.extract(r.question());
		Map<String, Object> env = new LinkedHashMap<>(x.env());
		if (r.envHints() != null) env.putAll(r.envHints());
		float[] q = emb.embed(x.statement());
		String at = SolutionAligner.text(r.answer());
		float[] a = at.isBlank() ? null : emb.embed(at);

		List<Rrf.Scored> hits = Rrf.fuse(ret.search(x.statement(), q, x.errorSigs()).all()).stream().limit(CANDIDATES).toList();
		Map<Long, MatchLoader.Row> rows = loader.load(hits.stream().map(Rrf.Scored::id).toList(), q, a);
		List<Match> ms = hits.stream()
				.map(h -> match(h, rows.get(h.id()), env))
				.filter(m -> (m.similarity() != null && m.similarity() >= MIN_SIM) || m.ranks().errorSig() != null)
				.sorted(Comparator.comparingDouble(Match::score).reversed())
				.limit(TOP).toList();
		return new VerifyResponse(new Extraction(x.statement(), x.errorSigs(), env), a == null ? null : aligner.align(ms), ms);
	}

	Match match(Rrf.Scored h, MatchLoader.Row p, Map<String, Object> env) {
		var pf = ctx.problem(env, p.env());
		double score = h.score() * (1 + BETA * (pf.score() - ContextMatcher.NEUTRAL)) * (pf.conflicts().isEmpty() ? 1 : CONFLICT_PENALTY);
		List<Solution> sols = p.solutions().stream().map(s -> {
			var sf = ctx.solution(env, s.attempts());
			return new Solution(s.id(), s.body(), s.steps(), s.code(), s.score(), s.accepted(), s.source(),
					outcomes(s.attempts()), sf.yourEnv() == null ? null : outcomes(sf.yourEnv()), sf.conflicts(),
					s.answerSimilarity());
		}).sorted(Comparator.comparing(s -> !s.conflicts().isEmpty())).toList();
		return new Match(p.id(), p.domain(), p.title(), score, p.similarity(),
				new Ranks(rank(h, 0), rank(h, 1), rank(h, 2)), new Fit(pf.score(), pf.conflicts()), p.env(),
				p.errorSigs(), p.source(), sols);
	}

	static Outcomes outcomes(List<Att> atts) {
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
