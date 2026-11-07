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

export type Outcome = 'worked' | 'partial' | 'failed';
export type FlagKind = 'outdated' | 'misleading';
export type TrustStatus = 'verified' | 'conflicting' | 'outdated' | 'partial' | 'failing' | 'unverified';

export interface Trust {
  status: TrustStatus;
  reasons: string[];
  successLower: number | null;
  reports: number;
  /** Whether seeded demo reports are counted. */
  synthetic: boolean;
}

export interface Votes {
  helpful: number;
  notHelpful: number;
}

export interface Flags {
  outdated: number;
  misleading: number;
}

/** The current user's own report, vote and flags. */
export interface Mine {
  outcome: Outcome | null;
  helpful: boolean | null;
  flags: FlagKind[];
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
  trust: Trust;
  votes: Votes;
  flags: Flags;
  mine: Mine;
}

/** Returned by every community write: the solution's updated evidence. */
export interface SolutionSummary {
  id: number;
  problemId: number;
  problemTitle: string;
  body: string;
  steps: string[];
  code: string | null;
  source: Source;
  outcomes: Outcomes;
  trust: Trust;
  votes: Votes;
  flags: Flags;
  mine: Mine;
}

export interface AttemptRequest {
  solutionId: number;
  outcome: Outcome;
  env?: Env;
  note?: string;
}

export interface VoteRequest {
  solutionId: number;
  helpful: boolean;
}

export interface FlagRequest {
  solutionId: number;
  kind: FlagKind;
}

/** A fix for an existing problem (problemId) or a new one (problem). */
export interface SubmitRequest {
  problemId?: number;
  problem?: { title: string; body: string };
  body: string;
  steps?: string[];
  code?: string;
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
  /** Trust status of the solution the answer aligned with; null when it matched none. */
  trustStatus: TrustStatus | null;
  matches: Match[];
}

export type Msg =
  | { type: 'verify'; req: VerifyRequest }
  | { type: 'attempt'; req: AttemptRequest }
  | { type: 'vote'; req: VoteRequest }
  | { type: 'flag'; req: FlagRequest }
  | { type: 'submit'; req: SubmitRequest };

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** What the panel can do; implemented by the content script via the background worker. */
export interface Actions {
  verify(): Promise<{ req: VerifyRequest; resp: VerifyResponse }>;
  attempt(r: AttemptRequest): Promise<SolutionSummary>;
  vote(r: VoteRequest): Promise<SolutionSummary>;
  flag(r: FlagRequest): Promise<SolutionSummary>;
  submit(r: SubmitRequest): Promise<SolutionSummary>;
}
