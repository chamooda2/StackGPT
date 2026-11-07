package dev.stackgpt.api.align;

import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.springframework.stereotype.Component;

import dev.stackgpt.api.verify.Dto.Alignment;
import dev.stackgpt.api.verify.Dto.Answer;
import dev.stackgpt.api.verify.Dto.CodeBlock;
import dev.stackgpt.api.verify.Dto.Match;
import dev.stackgpt.api.verify.Dto.Solution;

/**
 * Compares the AI answer with stored solutions of the top related problems by embedding cosine similarity
 * (computed in SQL as answerSimilarity). Thresholds are calibrated on the seeded corpus (see AlignmentEvalTest).
 * O(k * s) for k considered matches with s solutions each.
 */
@Component
public class SolutionAligner {
	public static final String MATCHES = "matches", PARTIAL = "partial", NOVEL = "novel";
	/** Calibrated in VerifyEvalTest: same fix reworded 0.81-0.95, a different fix for the same problem ~0.72. */
	public static final double T_MATCH = 0.78, T_PARTIAL = 0.70;
	/** Only problems at least this similar to the question are compared against. */
	public static final double RELATED = 0.70;
	static final int CONSIDER = 3;

	/** Text that represents the answer's fix: steps and code, or the prose when it has neither. */
	public static String text(Answer a) {
		if (a == null) return "";
		String sc = Stream.concat(
				a.steps() == null ? Stream.empty() : a.steps().stream(),
				a.codeBlocks() == null ? Stream.empty() : a.codeBlocks().stream().map(CodeBlock::code))
				.filter(s -> s != null && !s.isBlank()).collect(Collectors.joining("\n"));
		return !sc.isBlank() ? sc : a.prose() == null ? "" : a.prose().trim();
	}

	public Alignment align(List<Match> matches) {
		Match bm = null;
		Solution bs = null;
		for (Match m : matches.stream().limit(CONSIDER).toList()) {
			if (m.similarity() == null || m.similarity() < RELATED) continue;
			for (Solution s : m.solutions())
				if (s.answerSimilarity() != null && (bs == null || s.answerSimilarity() > bs.answerSimilarity())) {
					bm = m;
					bs = s;
				}
		}
		if (bs == null) return new Alignment(NOVEL, null, null, null);
		double x = bs.answerSimilarity();
		String v = x >= T_MATCH ? MATCHES : x >= T_PARTIAL ? PARTIAL : NOVEL;
		return new Alignment(v, bm.problemId(), bs.id(), x);
	}
}
