package dev.stackgpt.api.retrieve;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;

import org.junit.jupiter.api.Test;

class RrfTest {
	@Test
	void fusesThreeLists() {
		// vector=[1,2,3], text=[3,1], sig=[4]
		var r = Rrf.fuse(List.of(List.of(1L, 2L, 3L), List.of(3L, 1L), List.of(4L)));
		// 1: 1/61+1/62=.03252  3: 1/63+1/61=.03227  4: 1/61=.01639  2: 1/62=.01613
		assertThat(r).extracting(Rrf.Scored::id).containsExactly(1L, 3L, 4L, 2L);
		assertThat(r.get(0).score()).isCloseTo(1.0 / 61 + 1.0 / 62, within(1e-12));
		assertThat(r.get(0).ranks()).containsExactly(1, 2, 0);
		assertThat(r.get(1).ranks()).containsExactly(3, 1, 0);
		assertThat(r.get(2).ranks()).containsExactly(0, 0, 1);
	}

	@Test
	void tiesBreakByIdAscending() {
		assertThat(Rrf.fuse(List.of(List.of(2L), List.of(1L)))).extracting(Rrf.Scored::id).containsExactly(1L, 2L);
	}

	@Test
	void duplicateInOneListKeepsBestRank() {
		var r = Rrf.fuse(List.of(List.of(5L, 5L)));
		assertThat(r).hasSize(1);
		assertThat(r.get(0).ranks()).containsExactly(1);
		assertThat(r.get(0).score()).isCloseTo(1.0 / 61, within(1e-12));
	}

	@Test
	void emptyListsGiveNothing() {
		assertThat(Rrf.fuse(List.of(List.of(), List.of()))).isEmpty();
	}
}
