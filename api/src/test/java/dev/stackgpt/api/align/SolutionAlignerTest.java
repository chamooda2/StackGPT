package dev.stackgpt.api.align;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import dev.stackgpt.api.verify.Dto.Alignment;
import dev.stackgpt.api.verify.Dto.Answer;
import dev.stackgpt.api.verify.Dto.CodeBlock;
import dev.stackgpt.api.verify.Dto.Fit;
import dev.stackgpt.api.verify.Dto.Match;
import dev.stackgpt.api.verify.Dto.Ranks;
import dev.stackgpt.api.verify.Dto.Solution;

class SolutionAlignerTest {
	final SolutionAligner al = new SolutionAligner();

	static Solution sol(long id, Double sim) {
		return new Solution(id, "b", List.of(), null, null, false, null, null, null, List.of(), sim, null, null, null, null);
	}

	static Match match(long id, double sim, Solution... s) {
		return new Match(id, "programming", "t", 0, sim, new Ranks(1, null, null), new Fit(0.5, List.of()), Map.of(),
				List.of(), null, List.of(s));
	}

	@Test
	void textPrefersStepsAndCodeOverProse() {
		var a = new Answer("long prose", List.of(new CodeBlock("bash", "python3 -m venv .venv", true)), List.of("Create a venv"));
		assertThat(SolutionAligner.text(a)).isEqualTo("Create a venv\npython3 -m venv .venv");
		assertThat(SolutionAligner.text(new Answer(" only prose ", List.of(), List.of()))).isEqualTo("only prose");
		assertThat(SolutionAligner.text(null)).isEmpty();
	}

	@Test
	void picksTheMostSimilarSolutionAcrossRelatedMatches() {
		var r = al.align(List.of(match(1, 0.9, sol(10, 0.72), sol(11, 0.65)), match(2, 0.8, sol(20, 0.86))));
		assertThat(r).isEqualTo(new Alignment(SolutionAligner.MATCHES, 2L, 20L, 0.86));
	}

	@Test
	void verdictThresholds() {
		assertThat(al.align(List.of(match(1, 0.9, sol(10, SolutionAligner.T_MATCH)))).verdict()).isEqualTo("matches");
		assertThat(al.align(List.of(match(1, 0.9, sol(10, 0.75)))).verdict()).isEqualTo("partial");
		assertThat(al.align(List.of(match(1, 0.9, sol(10, 0.5)))).verdict()).isEqualTo("novel");
	}

	@Test
	void unrelatedMatchesAreIgnored() {
		// Problem similarity below RELATED: its solutions say nothing about this answer.
		assertThat(al.align(List.of(match(1, 0.5, sol(10, 0.95))))).isEqualTo(new Alignment("novel", null, null, null));
		assertThat(al.align(List.of())).isEqualTo(new Alignment("novel", null, null, null));
	}

	@Test
	void onlyTheTopThreeMatchesAreConsidered() {
		var r = al.align(List.of(match(1, 0.9, sol(10, 0.5)), match(2, 0.9), match(3, 0.9), match(4, 0.9, sol(40, 0.99))));
		assertThat(r.solutionId()).isEqualTo(10L);
	}
}
