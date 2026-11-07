// Shapes shared by content script, background worker and the API (/v1/verify).

export interface CodeBlock {
  lang: string | null;
  code: string;
  isShell: boolean;
}

export interface ExtractedAnswer {
  prose: string;
  codeBlocks: CodeBlock[];
  steps: string[];
}

export type Env = Record<string, unknown>;

export interface VerifyRequest {
  platform: string;
  question: string;
  answer: ExtractedAnswer;
  envHints?: Env;
}

export interface Source {
  name: string;
  id: string;
  url: string | null;
  author: string | null;
  license: string | null;
}

export interface Outcomes {
  worked: number;
  partial: number;
  failed: number;
  synthetic: number;
  lastAttempt: string | null;
}

export interface Solution {
  id: number;
  body: string;
  steps: string[];
  code: string | null;
  score: number | null;
  accepted: boolean;
  source: Source;
  outcomes: Outcomes;
}

export interface Match {
  problemId: number;
  domain: string;
  title: string;
  score: number;
  similarity: number | null;
  ranks: { vector: number | null; text: number | null; errorSig: number | null };
  env: Env;
  errorSigs: string[];
  source: Source;
  solutions: Solution[];
}

export interface VerifyResponse {
  query: { statement: string; errorSigs: string[]; env: Env };
  matches: Match[];
}

export type Msg = { type: 'verify'; req: VerifyRequest };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
