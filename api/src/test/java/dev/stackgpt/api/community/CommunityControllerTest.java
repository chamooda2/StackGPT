package dev.stackgpt.api.community;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

import dev.stackgpt.api.community.Requests.AttemptRequest;

@WebMvcTest(CommunityController.class)
class CommunityControllerTest {
	static final String TOKEN = "t".repeat(40);

	@Autowired MockMvc mvc;
	@MockitoBean CommunityService svc;
	@MockitoBean Users users;

	@Test
	void writeWithoutTokenIs401() throws Exception {
		when(users.require(null)).thenThrow(new ResponseStatusException(HttpStatus.UNAUTHORIZED));
		mvc.perform(post("/v1/attempts").contentType(MediaType.APPLICATION_JSON).content("{\"solutionId\":1,\"outcome\":\"worked\"}"))
				.andExpect(status().isUnauthorized());
		verifyNoInteractions(svc);
	}

	@Test
	void invalidOutcomeIs400() throws Exception {
		mvc.perform(post("/v1/attempts").header(Users.HEADER, TOKEN).contentType(MediaType.APPLICATION_JSON)
				.content("{\"solutionId\":1,\"outcome\":\"great\"}")).andExpect(status().isBadRequest());
		verifyNoInteractions(svc);
	}

	@Test
	void validAttemptGoesToTheServiceAsTheTokensUser() throws Exception {
		when(users.require(TOKEN)).thenReturn(7L);
		mvc.perform(post("/v1/attempts").header(Users.HEADER, TOKEN).contentType(MediaType.APPLICATION_JSON)
				.content("{\"solutionId\":1,\"outcome\":\"partial\",\"note\":\"only after reboot\"}")).andExpect(status().isOk());
		verify(svc).attempt(eq(7L), eq(new AttemptRequest(1L, "partial", null, "only after reboot")));
	}

	@Test
	void invalidFlagKindIs400() throws Exception {
		mvc.perform(post("/v1/flags").header(Users.HEADER, TOKEN).contentType(MediaType.APPLICATION_JSON)
				.content("{\"solutionId\":1,\"kind\":\"spam\"}")).andExpect(status().isBadRequest());
		verifyNoInteractions(svc);
	}

	@Test
	void submitIs201() throws Exception {
		when(users.require(TOKEN)).thenReturn(7L);
		mvc.perform(post("/v1/solutions").header(Users.HEADER, TOKEN).contentType(MediaType.APPLICATION_JSON)
				.content("{\"problemId\":3,\"body\":\"Reinstall the driver.\"}")).andExpect(status().isCreated());
		verify(svc).submit(anyLong(), any());
	}
}
