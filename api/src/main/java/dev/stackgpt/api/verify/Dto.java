package dev.stackgpt.api.verify;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import dev.stackgpt.api.extract.Extraction;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Request/response shapes for POST /v1/verify. */
public final class Dto {
	private Dto() {}

	public record VerifyRequest(
			@Size(max = 40) String platform,
			@NotBlank @Size(max = 20_000) String question,
			@Valid Answer answer,
			Map<String, Object> envHints) {}

	public record Answer(@Size(max = 50_000) String prose, List<CodeBlock> codeBlocks, List<String> steps) {}

	public record CodeBlock(String lang, String code, boolean isShell) {}

	/** alignment is null when no answer text was sent. */
	public record VerifyResponse(Extraction query, Alignment alignment, List<Match> matches) {}

	/** verdict: matches | partial | novel; ids/similarity null when nothing related was close enough. */
	public record Alignment(String verdict, Long problemId, Long solutionId, Double similarity) {}

	/**
	 * score: RRF score adjusted by context fit (and demoted on conflicts); ranks: 1-based position in each
	 * retrieval list, null when absent.
	 */
	public record Match(long problemId, String domain, String title, double score, Double similarity, Ranks ranks,
			Fit fit, Map<String, Object> env, List<String> errorSigs, Source source, List<Solution> solutions) {}

	public record Ranks(Integer vector, Integer text, Integer errorSig) {}

	/** Context fit with the user's environment in [0,1] (0.5 = nothing comparable), plus hard conflicts. */
	public record Fit(double score, List<String> conflicts) {}

	public record Source(String name, String id, String url, String author, String license) {}

	/** yourEnv: outcomes reported from setups like the user's, null when none are comparable. */
	public record Solution(long id, String body, List<String> steps, String code, Integer score, boolean accepted,
			Source source, Outcomes outcomes, Outcomes yourEnv, List<String> conflicts, Double answerSimilarity) {}

	/** Raw attempt counts; synthetic = how many of them are seeded demo data. */
	public record Outcomes(int worked, int partial, int failed, int synthetic, Instant lastAttempt) {}
}
