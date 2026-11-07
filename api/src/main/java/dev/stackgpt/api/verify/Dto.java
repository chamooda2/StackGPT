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

	public record VerifyResponse(Extraction query, List<Match> matches) {}

	/** ranks: 1-based position in each retrieval list, null when absent. */
	public record Match(long problemId, String domain, String title, double score, Double similarity, Ranks ranks,
			Map<String, Object> env, List<String> errorSigs, Source source, List<Solution> solutions) {}

	public record Ranks(Integer vector, Integer text, Integer errorSig) {}

	public record Source(String name, String id, String url, String author, String license) {}

	public record Solution(long id, String body, List<String> steps, String code, Integer score, boolean accepted,
			Source source, Outcomes outcomes) {}

	/** Raw attempt counts; synthetic = how many of them are seeded demo data. */
	public record Outcomes(int worked, int partial, int failed, int synthetic, Instant lastAttempt) {}
}
