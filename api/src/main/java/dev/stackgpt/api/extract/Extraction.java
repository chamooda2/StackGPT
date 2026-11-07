package dev.stackgpt.api.extract;

import java.util.List;
import java.util.Map;

/** Normalized problem statement, error signatures, and env facets {os, osVer, lang, pkg:{name:ver}, device}. */
public record Extraction(String statement, List<String> errorSigs, Map<String, Object> env) {}
