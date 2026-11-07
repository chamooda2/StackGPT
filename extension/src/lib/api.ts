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
  /** Outcomes reported from setups like the user's; null when none are comparable. */
  yourEnv: Outcomes | null;
  conflicts: string[];
  answerSimilarity: number | null;
}

export interface Match {
  problemId: number;
  domain: string;
  title: string;
  score: number;
  similarity: number | null;
  ranks: { vector: number | null; text: number | null; errorSig: number | null };
  /** Environment fit in [0,1], 0.5 = nothing comparable; conflicts are hard mismatches. */
  fit: { score: number; conflicts: string[] };
  env: Env;
  errorSigs: string[];
  source: Source;
  solutions: Solution[];
}

export type Verdict = 'matches' | 'partial' | 'novel';

export interface Alignment {
  verdict: Verdict;
  problemId: number | null;
  solutionId: number | null;
  similarity: number | null;
}

export interface VerifyResponse {
  query: { statement: string; errorSigs: string[]; env: Env };
  /** null when no answer text was sent. */
  alignment: Alignment | null;
  matches: Match[];
}

export type Msg = { type: 'verify'; req: VerifyRequest };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
