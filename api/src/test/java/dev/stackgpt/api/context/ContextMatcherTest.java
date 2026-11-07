package dev.stackgpt.api.context;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import dev.stackgpt.api.context.ContextMatcher.Att;
import dev.stackgpt.api.context.ContextMatcher.Counts;

class ContextMatcherTest {
	final ContextMatcher cm = new ContextMatcher();

	static List<Att> atts(int n, String outcome, Map<String, Object> env) {
		List<Att> l = new ArrayList<>();
		for (int i = 0; i < n; i++) l.add(new Att(outcome, true, env, Instant.EPOCH));
		return l;
	}

	@SafeVarargs
	static List<Att> concat(List<Att>... ls) {
		List<Att> l = new ArrayList<>();
		for (var x : ls) l.addAll(x);
		return l;
	}

	// --- problem fit ---

	@Test
	void nothingComparableIsNeutral() {
		var f = cm.problem(Map.of("lang", "python"), Map.of("device", "Kindle"));
		assertThat(f.score()).isEqualTo(ContextMatcher.NEUTRAL);
		assertThat(f.conflicts()).isEmpty();
	}

	// fit = (sum w*sim + 0.5 * 2) / (sum w + 2): the prior of weight 2 pulls thin evidence toward neutral.

	@Test
	void explicitOsMismatchIsHardConflict() {
		var f = cm.problem(Map.of("os", "windows"), Map.of("os", "macos"));
		assertThat(f.score()).isCloseTo((0 + 1) / 5.0, within(1e-9));
		assertThat(f.conflicts()).containsExactly("This problem is on macOS; you're on Windows");
	}

	@Test
	void browserOsIsOnlyAWeakHint() {
		// Asking about an iPhone from a Windows PC must not conflict; the differing hint costs little.
		var f = cm.problem(Map.of("clientOs", "windows"), Map.of("os", "ios"));
		assertThat(f.conflicts()).isEmpty();
		assertThat(f.score()).isCloseTo((0 + 1) / 3.0, within(1e-9));
	}

	@Test
	void weightedFacetsWithVersionDistance() {
		// os 3*1 + osVer 1*1 (same) + lang 1*1 + python 1*(1/(1+1)) = 5.5 of 6
		var f = cm.problem(
				Map.of("os", "linux", "osVer", "ubuntu 24.04", "lang", "python", "pkg", Map.of("python", "3.11")),
				Map.of("os", "linux", "osVer", "ubuntu 24.04", "lang", "python", "pkg", Map.of("python", "3.12")));
		assertThat(f.score()).isCloseTo((5.5 + 1) / 8, within(1e-9));
	}

	@Test
	void sameDeviceFamilyIsHalf() {
		// device 2 * 0.5 (galaxy a14 vs galaxy s22) + os 3 * 1 = 4 of 5
		var f = cm.problem(Map.of("os", "android", "device", "Galaxy A14"), Map.of("os", "android", "device", "Samsung Galaxy S22"));
		assertThat(f.score()).isCloseTo((4.0 + 1) / 7, within(1e-9));
	}

	@Test
	void iosAndIpadosArePartialNotConflict() {
		var f = cm.problem(Map.of("os", "ipados"), Map.of("os", "ios"));
		assertThat(f.score()).isCloseTo((1.5 + 1) / 5, within(1e-9));
		assertThat(f.conflicts()).isEmpty();
	}

	// --- solution fit ---

	@Test
	void modelSpecificFixFailsOnUsersDevice() {
		var a = concat(atts(9, "worked", Map.of("os", "android", "device", "Samsung Galaxy S24")),
				atts(1, "failed", Map.of("os", "android", "device", "Samsung Galaxy S24")),
				atts(1, "worked", Map.of("os", "android", "device", "Samsung Galaxy A14")),
				atts(1, "partial", Map.of("os", "android", "device", "Samsung Galaxy A14")),
				atts(8, "failed", Map.of("os", "android", "device", "Samsung Galaxy A14")));
		var f = cm.solution(Map.of("os", "android", "device", "Galaxy A14"), a);
		assertThat(f.yourEnv()).isEqualTo(new Counts(1, 1, 8, 10));
		assertThat(f.conflicts()).containsExactly("Mostly fails in setups like yours (Galaxy A14) but works in others");
	}

	@Test
	void sameFixOnTheWorkingDeviceHasNoConflict() {
		var a = concat(atts(9, "worked", Map.of("device", "Samsung Galaxy S24")), atts(8, "failed", Map.of("device", "Samsung Galaxy A14")));
		var f = cm.solution(Map.of("device", "Galaxy S24"), a);
		assertThat(f.yourEnv()).isEqualTo(new Counts(9, 0, 0, 9));
		assertThat(f.conflicts()).isEmpty();
	}

	@Test
	void osSpecificReportsConflictWithExplicitOs() {
		var a = atts(20, "worked", Map.of("os", "windows"));
		var f = cm.solution(Map.of("os", "macos"), a);
		assertThat(f.yourEnv()).isNull(); // every report mismatches -> none from the user's setup
		assertThat(f.conflicts()).containsExactly("Reports for this fix come from Windows; you're on macOS");
	}

	@Test
	void tooFewReportsDoNotMakeAFixOsSpecific() {
		assertThat(cm.solution(Map.of("os", "macos"), atts(4, "worked", Map.of("os", "windows"))).conflicts()).isEmpty();
	}

	@Test
	void osVersionSegmentsUseAllSharedComponents() {
		var a = concat(atts(9, "worked", Map.of("os", "windows", "osVer", "11 23H2")), atts(8, "failed", Map.of("os", "windows", "osVer", "11 24H2")));
		var f = cm.solution(Map.of("os", "windows", "osVer", "11 24H2"), a);
		assertThat(f.yourEnv()).isEqualTo(new Counts(0, 0, 8, 8));
		assertThat(f.conflicts()).hasSize(1).first().asString().startsWith("Mostly fails in setups like yours (Windows 11 24H2)");
	}

	@Test
	void packageVersionSegments() {
		var a = concat(atts(9, "worked", Map.of("pkg", Map.of("python", "3.11"))), atts(8, "failed", Map.of("pkg", Map.of("python", "3.13"))));
		var f = cm.solution(Map.of("pkg", Map.of("python", "3.13.1")), a);
		assertThat(f.yourEnv()).isEqualTo(new Counts(0, 0, 8, 8));
		assertThat(f.conflicts()).containsExactly("Mostly fails in setups like yours (python 3.13.1) but works in others");
	}

	@Test
	void noComparableFacetsMeansNoYourEnv() {
		var f = cm.solution(Map.of("lang", "python"), atts(10, "worked", Map.of("os", "linux")));
		assertThat(f.yourEnv()).isNull();
		assertThat(f.conflicts()).isEmpty();
	}

	// --- helpers ---

	@Test
	void helpers() {
		assertThat(ContextMatcher.device("Samsung Galaxy A14 (4G)")).isEqualTo("galaxy a14");
		assertThat(ContextMatcher.deviceSim("AirPods Pro (2nd gen)", "AirPods Pro")).isEqualTo(1.0);
		assertThat(ContextMatcher.deviceSim("AirPods", "AirPods Pro (2nd gen)")).isEqualTo(0.75);
		assertThat(ContextMatcher.deviceSim("iPhone 13", "Pixel 8")).isEqualTo(0.0);
		assertThat(ContextMatcher.versionSim("3.12", "3.10")).isCloseTo(1.0 / 3, within(1e-9));
		assertThat(ContextMatcher.versionSim("2.0.0", "1.26")).isEqualTo(0.0);
		assertThat(ContextMatcher.versionSim("latest", "1.2")).isNaN();
		assertThat(ContextMatcher.sameVersion("14", "14.1")).isTrue();
		assertThat(ContextMatcher.sameVersion("11 23H2", "11 24H2")).isFalse();
		assertThat(ContextMatcher.sameVersion("n/a", "14")).isNull();
	}
}
