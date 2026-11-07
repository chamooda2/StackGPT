package dev.stackgpt.api.verify;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import dev.stackgpt.api.verify.Dto.VerifyRequest;
import dev.stackgpt.api.verify.Dto.VerifyResponse;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/v1")
public class VerifyController {
	private final VerifyService svc;

	public VerifyController(VerifyService svc) {
		this.svc = svc;
	}

	@PostMapping("/verify")
	public VerifyResponse verify(@Valid @RequestBody VerifyRequest r) {
		return svc.verify(r);
	}
}
