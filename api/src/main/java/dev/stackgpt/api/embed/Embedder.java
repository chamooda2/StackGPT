package dev.stackgpt.api.embed;

import java.util.List;

public interface Embedder {
	int DIM = 384;

	float[] embed(String text);

	List<float[]> embedAll(List<String> texts);

	/** pgvector text literal "[a,b,...]". O(d). */
	static String literal(float[] v) {
		StringBuilder b = new StringBuilder(v.length * 12).append('[');
		for (int i = 0; i < v.length; i++) {
			if (i > 0) b.append(',');
			b.append(v[i]);
		}
		return b.append(']').toString();
	}
}
