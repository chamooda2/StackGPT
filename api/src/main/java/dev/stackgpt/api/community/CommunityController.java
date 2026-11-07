package dev.stackgpt.api.community;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import dev.stackgpt.api.community.Requests.AttemptRequest;
import dev.stackgpt.api.community.Requests.FlagRequest;
import dev.stackgpt.api.community.Requests.SolutionRequest;
import dev.stackgpt.api.community.Requests.VoteRequest;
import dev.stackgpt.api.verify.Dto.SolutionSummary;
import jakarta.validation.Valid;

/** Writes need the anonymous user token (X-StackGPT-Token); reads accept it optionally. */
@RestController
@RequestMapping("/v1")
public class CommunityController {
	private final CommunityService svc;
	private final Users users;

	public CommunityController(CommunityService svc, Users users) {
		this.svc = svc;
		this.users = users;
	}

	@PostMapping("/attempts")
	public SolutionSummary attempt(@Valid @RequestBody AttemptRequest r, @RequestHeader(name = Users.HEADER, required = false) String token) {
		return svc.attempt(users.require(token), r);
	}

	@PostMapping("/votes")
	public SolutionSummary vote(@Valid @RequestBody VoteRequest r, @RequestHeader(name = Users.HEADER, required = false) String token) {
		return svc.vote(users.require(token), r);
	}

	@PostMapping("/flags")
	public SolutionSummary flag(@Valid @RequestBody FlagRequest r, @RequestHeader(name = Users.HEADER, required = false) String token) {
		return svc.flag(users.require(token), r);
	}

	@PostMapping("/solutions")
	@ResponseStatus(HttpStatus.CREATED)
	public SolutionSummary submit(@Valid @RequestBody SolutionRequest r, @RequestHeader(name = Users.HEADER, required = false) String token) {
		return svc.submit(users.require(token), r);
	}

	@GetMapping("/solutions/{id}")
	public SolutionSummary get(@PathVariable long id, @RequestHeader(name = Users.HEADER, required = false) String token) {
		return svc.summary(id, users.find(token));
	}
}
