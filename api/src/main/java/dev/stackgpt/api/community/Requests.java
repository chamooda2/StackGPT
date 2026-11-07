package dev.stackgpt.api.community;

import java.util.List;
import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Request bodies for the community write endpoints. */
public final class Requests {
	private Requests() {}

	/** One report per user per solution; posting again replaces it. */
	public record AttemptRequest(
			@NotNull Long solutionId,
			@NotNull @Pattern(regexp = "worked|partial|failed") String outcome,
			Map<String, Object> env,
			@Size(max = 2000) String note) {}

	public record VoteRequest(@NotNull Long solutionId, @NotNull Boolean helpful) {}

	public record FlagRequest(@NotNull Long solutionId, @NotNull @Pattern(regexp = "outdated|misleading") String kind) {}

	/** A fix for an existing problem (problemId) or for a new one (problem); exactly one must be given. */
	public record SolutionRequest(
			Long problemId,
			@Valid NewProblem problem,
			@NotBlank @Size(max = 20_000) String body,
			@Size(max = 50) List<@Size(max = 2000) String> steps,
			@Size(max = 20_000) String code) {}

	public record NewProblem(@NotBlank @Size(max = 300) String title, @NotBlank @Size(max = 20_000) String body) {}
}
