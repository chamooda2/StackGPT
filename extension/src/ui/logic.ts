// Pure helpers for the panel: wording, status metadata and state updates. No DOM.
import type { Outcomes, Solution, SolutionSummary, SubmitRequest, TrustStatus, VerifyRequest, VerifyResponse } from '../lib/api';

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export const STATUS: Record<TrustStatus, { label: string; tone: Tone; blurb: string }> = {
  verified: { label: 'Verified fix', tone: 'ok', blurb: 'Most people who tried this fix report that it worked.' },
  conflicting: { label: 'Conflicting results', tone: 'warn', blurb: 'This fix works in some setups and fails in others.' },
  outdated: { label: 'Outdated fix', tone: 'warn', blurb: 'This fix used to work, but recent reports say it no longer does.' },
  partial: { label: 'Mixed results', tone: 'warn', blurb: 'Reports are mixed: it works for some people, partly or not at all for others.' },
  failing: { label: 'Mostly fails', tone: 'bad', blurb: 'Most people who tried this fix report that it did not work.' },
  unverified: { label: 'Unverified', tone: 'muted', blurb: 'Too few reports to say whether this fix works.' },
};

/** A shared answer is filed under the top match only when it is clearly the same problem. */
export const SAME_PROBLEM = 0.85;

export const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : w.endsWith('x') ? 'es' : 's'}`;
export const total = (o: Outcomes) => o.worked + o.partial + o.failed;
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The stored solution the answer matched or overlapped with, if any. */
export function aligned(d: VerifyResponse): Solution | undefined {
  const a = d.alignment;
  if (!a || a.solutionId == null || a.verdict === 'novel') return undefined;
  return d.matches.flatMap(m => m.solutions).find(s => s.id === a.solutionId);
}

/** Badge text: what the community evidence says about this answer, in one short phrase. */
export function headline(d: VerifyResponse): string {
  const s = aligned(d);
  if (s) {
    const n = total(s.outcomes);
    const evidence = n ? `${s.outcomes.worked} of ${n} worked` : 'no reports yet';
    const fit = s.conflicts.length ? ' · may not fit your setup' : '';
    return `${d.alignment!.verdict === 'partial' ? 'Similar fix: ' : ''}${STATUS[s.trust.status].label} · ${evidence}${fit}`;
  }
  if (d.alignment?.verdict === 'novel') return 'New fix · no community evidence yet';
  if (d.matches.length === 0) return 'No similar problems found';
  return plural(d.matches.length, 'similar problem');
}

/** Tone of the badge dot: the aligned fix's trust, or neutral. */
export function tone(d: VerifyResponse): Tone {
  const s = aligned(d);
  return s ? STATUS[s.trust.status].tone : 'muted';
}

/** Replaces one solution's community evidence with the summary a write returned. */
export function patch(d: VerifyResponse, s: SolutionSummary): VerifyResponse {
  return {
    ...d,
    trustStatus: d.alignment?.solutionId === s.id ? s.trust.status : d.trustStatus,
    matches: d.matches.map(m => ({
      ...m,
      solutions: m.solutions.map(x =>
        x.id === s.id ? { ...x, outcomes: s.outcomes, trust: s.trust, votes: s.votes, flags: s.flags, mine: s.mine } : x,
      ),
    })),
  };
}

/** Request that shares the AI answer as a new fix: under the top match if it is the same problem, else a new one. */
export function shareRequest(d: VerifyResponse, req: VerifyRequest): SubmitRequest {
  const top = d.matches[0];
  const same = top && (top.similarity ?? 0) >= SAME_PROBLEM && top.fit.conflicts.length === 0;
  const a = req.answer;
  const code = a.codeBlocks.map(c => c.code).join('\n\n');
  return {
    ...(same ? { problemId: top.problemId } : { problem: { title: req.question.split('\n')[0]!.slice(0, 300), body: req.question.slice(0, 20_000) } }),
    body: (a.prose || a.steps.join('\n')).slice(0, 20_000),
    steps: a.steps.slice(0, 50),
    ...(code ? { code: code.slice(0, 20_000) } : {}),
  };
}
