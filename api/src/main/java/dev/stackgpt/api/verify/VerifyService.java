package dev.stackgpt.api.verify;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import dev.stackgpt.api.embed.Embedder;
import dev.stackgpt.api.extract.Extraction;
import dev.stackgpt.api.extract.ProblemExtractor;
import dev.stackgpt.api.retrieve.Retriever;
import dev.stackgpt.api.retrieve.Rrf;
import dev.stackgpt.api.verify.Dto.VerifyRequest;
import dev.stackgpt.api.verify.Dto.VerifyResponse;

/** Pipeline so far: extract -> embed -> hybrid retrieve -> RRF fuse -> load top matches. */
@Service
public class VerifyService {
	static final int TOP = 10;

	private final ProblemExtractor ex;
	private final Embedder emb;
	private final Retriever ret;
	private final MatchLoader loader;

	public VerifyService(ProblemExtractor ex, Embedder emb, Retriever ret, MatchLoader loader) {
		this.ex = ex;
		this.emb = emb;
		this.ret = ret;
		this.loader = loader;
	}

	public VerifyResponse verify(VerifyRequest r) {
		Extraction x = ex.extract(r.question());
		Map<String, Object> env = new LinkedHashMap<>(x.env());
		if (r.envHints() != null) env.putAll(r.envHints());
		float[] q = emb.embed(x.statement());
		List<Rrf.Scored> top = Rrf.fuse(ret.search(x.statement(), q, x.errorSigs()).all()).stream().limit(TOP).toList();
		return new VerifyResponse(new Extraction(x.statement(), x.errorSigs(), env), loader.load(top, q));
	}
}
