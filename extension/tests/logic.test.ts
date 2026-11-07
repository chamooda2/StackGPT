import { describe, expect, it } from 'vitest';
import type { SolutionSummary, VerifyRequest, VerifyResponse } from '../src/lib/api';
import { headline, patch, plural, SAME_PROBLEM, shareRequest, tone } from '../src/ui/logic';
import recorded from './fixtures/verify-response.json';

// Recorded from the API: Galaxy A14 question whose answer matches a fix that works on the S24 but not the A14.
const resp = recorded as unknown as VerifyResponse;
const top = resp.matches[0]!;
const sol = top.solutions[0]!;
const novel: VerifyResponse = { ...resp, alignment: { verdict: 'novel', problemId: null, solutionId: null, similarity: null } };
const req: VerifyRequest = {
  platform: 'chatgpt',
  question: "My Samsung Galaxy A14 won't super fast charge\nwith a 25W charger",
  answer: { prose: 'Enable Super fast charging.', codeBlocks: [], steps: ['Open Settings', 'Enable it'] },
};

describe('headline', () => {
  const o = sol.outcomes;
  const n = o.worked + o.partial + o.failed;

  it('names the trust of the matching fix, how many it worked for, and a fit warning', () => {
    expect(headline(resp)).toBe(`Conflicting results · ${o.worked} of ${n} worked · may not fit your setup`);
  });

  it('marks a partial overlap', () => {
    expect(headline({ ...resp, alignment: { ...resp.alignment!, verdict: 'partial' } })).toBe(
      `Similar fix: Conflicting results · ${o.worked} of ${n} worked · may not fit your setup`,
    );
  });

  it('covers novel, no answer and no matches', () => {
    expect(headline(novel)).toBe('New fix · no community evidence yet');
    expect(headline({ ...resp, alignment: null })).toBe('1 similar problem');
    expect(headline({ ...resp, alignment: null, matches: [] })).toBe('No similar problems found');
  });
});

describe('tone', () => {
  it('follows the aligned fix, neutral otherwise', () => {
    expect(tone(resp)).toBe('warn');
    expect(tone(novel)).toBe('muted');
  });
});

describe('plural', () => {
  it('handles "fix"', () => {
    expect(plural(1, 'fix')).toBe('1 fix');
    expect(plural(2, 'fix')).toBe('2 fixes');
    expect(plural(3, 'similar problem')).toBe('3 similar problems');
  });
});

describe('patch', () => {
  it("replaces one solution's evidence and the top-level trust status, keeping the rest", () => {
    const s: SolutionSummary = {
      id: sol.id, problemId: top.problemId, problemTitle: top.title, body: sol.body, steps: sol.steps, code: sol.code,
      source: sol.source, outcomes: { ...sol.outcomes, worked: sol.outcomes.worked + 1 }, trust: { ...sol.trust, status: 'verified' },
      votes: sol.votes, flags: sol.flags, mine: { outcome: 'worked', helpful: null, flags: [] },
    };
    const p = patch(resp, s);
    expect(p.matches[0]!.solutions[0]!.outcomes.worked).toBe(sol.outcomes.worked + 1);
    expect(p.matches[0]!.solutions[0]!.mine.outcome).toBe('worked');
    expect(p.trustStatus).toBe('verified');
    expect(p.matches[0]!.solutions[0]!.yourEnv).toEqual(sol.yourEnv);
  });
});

describe('shareRequest', () => {
  it('files the answer under the top match only when it is clearly the same problem', () => {
    const same = { ...resp, matches: [{ ...top, similarity: SAME_PROBLEM, fit: { score: 0.8, conflicts: [] } }] };
    expect(shareRequest(same, req)).toEqual({ problemId: top.problemId, body: 'Enable Super fast charging.', steps: ['Open Settings', 'Enable it'] });
    const other = { ...resp, matches: [{ ...top, similarity: SAME_PROBLEM - 0.01 }] };
    expect(shareRequest(other, req).problem).toEqual({ title: "My Samsung Galaxy A14 won't super fast charge", body: req.question });
  });

  it('includes code blocks', () => {
    const r = { ...req, answer: { ...req.answer, codeBlocks: [{ lang: 'bash', code: 'a', isShell: true }, { lang: null, code: 'b', isShell: false }] } };
    expect(shareRequest(novel, r).code).toBe('a\n\nb');
  });
});
