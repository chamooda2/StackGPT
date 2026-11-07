package dev.stackgpt.api.embed;

import java.util.List;

import org.springframework.stereotype.Component;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.embedding.onnx.bgesmallenv15q.BgeSmallEnV15QuantizedEmbeddingModel;

/** bge-small-en-v1.5 (quantized ONNX), in-process. Texts beyond 512 tokens are split and averaged by LangChain4j. */
@Component
public class LocalEmbedder implements Embedder {
	private final EmbeddingModel m = new BgeSmallEnV15QuantizedEmbeddingModel();

	@Override
	public float[] embed(String text) {
		return m.embed(text).content().vector();
	}

	@Override
	public List<float[]> embedAll(List<String> texts) {
		return m.embedAll(texts.stream().map(TextSegment::from).toList()).content().stream().map(Embedding::vector).toList();
	}
}
