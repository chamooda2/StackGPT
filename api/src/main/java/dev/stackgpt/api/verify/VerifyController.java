package dev.stackgpt.api.verify;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import dev.stackgpt.api.community.Users;
import dev.stackgpt.api.verify.Dto.VerifyRequest;
import dev.stackgpt.api.verify.Dto.VerifyResponse;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/v1")
public class VerifyController {
	private final VerifyService svc;
	private final Users users;

	public VerifyController(VerifyService svc, Users users) {
		this.svc = svc;
		this.users = users;
	}

	/** The token is optional here; with it, the response includes the user's own reports. */
	@PostMapping("/verify")
	public VerifyResponse verify(@Valid @RequestBody VerifyRequest r, @RequestHeader(name = Users.HEADER, required = false) String token) {
		return svc.verify(r, users.find(token));
	}
}
