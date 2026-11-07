package dev.stackgpt.api.community;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class UsersTest {
	@Test
	void tokenFormat() {
		assertThat(Users.valid("a".repeat(32))).isTrue();
		assertThat(Users.valid("Ab0_-".repeat(20))).isTrue();
		assertThat(Users.valid("a".repeat(31))).isFalse();
		assertThat(Users.valid("a".repeat(129))).isFalse();
		assertThat(Users.valid("a".repeat(31) + " ")).isFalse();
		assertThat(Users.valid(null)).isFalse();
	}

	@Test
	void storesOnlyTheSha256() {
		assertThat(Users.hash("abc")).isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	}
}
