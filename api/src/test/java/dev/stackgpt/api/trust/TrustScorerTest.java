package dev.stackgpt.api.trust;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import dev.stackgpt.api.context.ContextMatcher.Att;
import dev.stackgpt.api.verify.Dto.Flags;

class TrustScorerTest {
	static final Instant NOW = Instant.parse("2026-11-07T00:00:00Z");
	static final Flags NO_FLAGS = new Flags(0, 0);
	final TrustScorer ts = new TrustScorer();

	/** n reports with the given outcome, `daysAgo` days old, in env. */
	static List<Att> r(int n, String outcome, int daysAgo, Map<String, Object> env) {
		List<Att> l = new ArrayList<>();
		for (int i = 0; i < n; i++) l.add(new Att(outcome, false, env, NOW.minus(Duration.ofDays(daysAgo))));
		return l;
	}

	static List<Att> r(int n, String outcome, int daysAgo) {
		return r(n, outcome, daysAgo, Map.of());
	}

	@SafeVarargs
	static List<Att> all(List<Att>... ls) {
		List<Att> l = new ArrayList<>();
		for (var x : ls) l.addAll(x);
		return l;
	}

	@Test
	void wilsonBounds() {
		// 19.5 successes of 20 (19 worked + 1 partial): lower bound ~0.80
		assertThat(TrustScorer.wilson(19.5, 20, -1)).isCloseTo(0.7996, within(1e-3));
		assertThat(TrustScorer.wilson(1.5, 10, 1)).isCloseTo(0.4593, within(1e-3));
		assertThat(TrustScorer.wilson(0, 0, -1)).isEqualTo(0.0);
	}

	@Test
	void verified() {
		var t = ts.score(all(r(19, "worked", 30), r(1, "partial", 30)), NO_FLAGS, NOW);
		assertThat(t.status()).isEqualTo("verified");
		assertThat(t.reasons()).containsExactly("19 of 20 reports worked (at least 80% with 95% confidence)");
		assertThat(t.reports()).isEqualTo(20);
		assertThat(t.synthetic()).isFalse();
	}

	@Test
	void fewReportsAreUnverifiedEvenIfAllWorked() {
		var t = ts.score(r(4, "worked", 10), NO_FLAGS, NOW);
		assertThat(t.status()).isEqualTo("unverified");
		assertThat(t.reasons()).containsExactly("Only 4 reports so far");
		assertThat(ts.score(List.of(), NO_FLAGS, NOW).reasons()).containsExactly("No reports yet");
	}

	@Test
	void recentFailuresAfterOldSuccessesAreOutdated() {
		var t = ts.score(all(r(10, "worked", 600), r(1, "partial", 600), r(6, "failed", 20), r(1, "partial", 20)), NO_FLAGS, NOW);
		assertThat(t.status()).isEqualTo("outdated");
		assertThat(t.reasons()).containsExactly("Worked before (10 of 11), but 6 of the last 7 reports failed");
	}

	@Test
	void noSuccessForTwoYearsIsOutdated() {
		var t = ts.score(r(8, "worked", 800), NO_FLAGS, NOW);
		assertThat(t.status()).isEqualTo("outdated");
		assertThat(t.reasons().get(0)).startsWith("No successful report since ");
	}

	@Test
	void userFlagsMarkOutdatedRegardlessOfReports() {
		var t = ts.score(r(20, "worked", 5), new Flags(3, 0), NOW);
		assertThat(t.status()).isEqualTo("outdated");
		assertThat(t.reasons()).containsExactly("3 users flagged this as outdated");
	}

	@Test
	void divergingDeviceSegmentsAreConflicting() {
		var t = ts.score(all(
				r(9, "worked", 10, Map.of("device", "Samsung Galaxy S24")), r(1, "failed", 10, Map.of("device", "Samsung Galaxy S24")),
				r(1, "worked", 10, Map.of("device", "Galaxy A14")), r(8, "failed", 10, Map.of("device", "Galaxy A14"))), NO_FLAGS, NOW);
		assertThat(t.status()).isEqualTo("conflicting");
		assertThat(t.reasons()).containsExactly("Works on Samsung Galaxy S24 (9 of 10) but not on Galaxy A14 (1 of 9)");
	}

	@Test
	void divergingPackageVersionsAreConflicting() {
		var t = ts.score(all(r(9, "worked", 10, Map.of("pkg", Map.of("python", "3.11"))),
				r(8, "failed", 10, Map.of("pkg", Map.of("python", "3.13")))), NO_FLAGS, NOW);
		assertThat(t.reasons()).containsExactly("Works on python 3.11 (9 of 9) but not on python 3.13 (0 of 8)");
	}

	@Test
	void smallSegmentsDoNotConflict() {
		// 2 Linux failures are below SEGMENT_MIN; 25 of 27 overall has a lower bound of ~0.77
		var t = ts.score(all(r(25, "worked", 10, Map.of("os", "windows")), r(2, "failed", 10, Map.of("os", "linux"))), NO_FLAGS, NOW);
		assertThat(t.status()).isEqualTo("verified");
	}

	@Test
	void mostlyFailingWithEnoughReportsIsFailing() {
		var t = ts.score(all(r(1, "worked", 10), r(1, "partial", 10), r(8, "failed", 10)), NO_FLAGS, NOW);
		assertThat(t.status()).isEqualTo("failing");
		assertThat(t.reasons()).containsExactly("Only 1 of 10 reports worked");
	}

	@Test
	void mixedResultsArePartial() {
		var t = ts.score(all(r(5, "worked", 10), r(4, "partial", 10), r(3, "failed", 10)), NO_FLAGS, NOW);
		assertThat(t.status()).isEqualTo("partial");
		assertThat(t.reasons()).containsExactly("Mixed results: 5 of 12 reports worked, 4 partly, 3 failed");
	}

	@Test
	void misleadingFlagsAddAReasonAndSyntheticIsReported() {
		var a = new ArrayList<>(r(19, "worked", 10));
		a.add(new Att("worked", true, Map.of(), NOW.minus(Duration.ofDays(3))));
		var t = ts.score(a, new Flags(0, 3), NOW);
		assertThat(t.status()).isEqualTo("verified");
		assertThat(t.reasons()).hasSize(2).last().isEqualTo("3 users flagged this as misleading");
		assertThat(t.synthetic()).isTrue();
	}
}
