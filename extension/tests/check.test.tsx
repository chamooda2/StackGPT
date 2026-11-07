import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Actions, SolutionSummary, VerifyRequest, VerifyResponse } from '../src/lib/api';
import { Check, headline, patch, SAME_PROBLEM, shareRequest } from '../src/ui/Check';
import recorded from './fixtures/verify-response.json';

// Recorded from the API: Galaxy A14 question whose answer matches a fix that works on the S24 but not the A14.
const resp = recorded as unknown as VerifyResponse;
const top = resp.matches[0]!;
const sol = top.solutions[0]!;
const req: VerifyRequest = {
  platform: 'chatgpt',
  question: "My Samsung Galaxy A14 won't super fast charge\nwith a 25W charger",
  answer: { prose: 'Enable Super fast charging.', codeBlocks: [], steps: ['Open Settings', 'Enable it'] },
};

const summary = (over: Partial<SolutionSummary> = {}): SolutionSummary => ({
  id: sol.id, problemId: top.problemId, problemTitle: top.title, body: sol.body, steps: sol.steps, code: sol.code,
  source: sol.source, outcomes: { ...sol.outcomes, worked: sol.outcomes.worked + 1 }, trust: sol.trust, votes: sol.votes,
  flags: sol.flags, mine: { outcome: 'worked', helpful: null, flags: [] }, ...over,
});

type FakeActions = { [K in keyof Actions]: Mock<Actions[K]> };

function fakeActions(data: VerifyResponse = resp): FakeActions {
  return {
    verify: vi.fn<Actions['verify']>(async () => ({ req, resp: data })),
    attempt: vi.fn<Actions['attempt']>(async () => summary()),
    vote: vi.fn<Actions['vote']>(async () => summary({ votes: { helpful: 1, notHelpful: 0 }, mine: { outcome: null, helpful: true, flags: [] } })),
    flag: vi.fn<Actions['flag']>(async () => summary({ flags: { outdated: 1, misleading: 0 }, mine: { outcome: null, helpful: null, flags: ['outdated'] } })),
    submit: vi.fn<Actions['submit']>(async () => summary({ id: 999 })),
  };
}

const open = async (a: Actions) => {
  render(<Check actions={a} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check with StackGPT' }));
  await screen.findByText(top.title);
};

const solutionEl = () => screen.getByText(sol.body.slice(0, 40), { exact: false }).closest('.sg-sol') as HTMLElement;

afterEach(cleanup);

describe('headline', () => {
  it('names the trust status of the matching fix, its outcomes and a fit warning', () => {
    const o = sol.outcomes;
    expect(headline(resp)).toBe(
      `StackGPT: matches a fix with conflicting results (${o.worked} worked · ${o.partial} partial · ${o.failed} failed) · may not fit your setup`,
    );
  });

  it('covers partial, novel, no answer and no matches', () => {
    expect(headline({ ...resp, alignment: { ...resp.alignment!, verdict: 'partial' } })).toMatch(/^StackGPT: partly overlaps a fix with conflicting results \(/);
    expect(headline({ ...resp, alignment: { verdict: 'novel', problemId: null, solutionId: null, similarity: null } })).toBe(
      'StackGPT: 1 similar problem, but this fix has no evidence yet',
    );
    expect(headline({ ...resp, alignment: null })).toBe(`StackGPT: 1 similar problem · best match ${Math.round(top.similarity! * 100)}%`);
    expect(headline({ ...resp, matches: [] })).toBe('StackGPT: no similar problems found');
  });
});

describe('patch', () => {
  it("replaces one solution's evidence and the top-level trust status", () => {
    const p = patch(resp, summary({ trust: { ...sol.trust, status: 'verified' } }));
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
});

describe('Check panel', () => {
  it('sends nothing until the user clicks Check', () => {
    const a = fakeActions();
    render(<Check actions={a} />);
    expect(a.verify).not.toHaveBeenCalled();
  });

  it('shows trust with reasons and demo-data labelling, setup outcomes and conflicts', async () => {
    await open(fakeActions());
    const el = within(solutionEl());
    expect(el.getByText('Conflicting')).toBeTruthy();
    expect(el.getByText(sol.trust.reasons[0]!, { exact: false })).toBeTruthy();
    expect(el.getByText('demo data', { exact: false })).toBeTruthy();
    expect(el.getByText(/^In setups like yours:/)).toBeTruthy();
    expect(el.getByText(sol.conflicts[0]!)).toBeTruthy();
    expect(el.getByText(`Same fix as this answer (${Math.round(resp.alignment!.similarity! * 100)}%)`)).toBeTruthy();
  });

  it('reports an outcome with an optional note and shows the updated evidence', async () => {
    const a = fakeActions();
    await open(a);
    const el = within(solutionEl());
    fireEvent.click(el.getByRole('button', { name: 'Add context' }));
    fireEvent.input(el.getByRole('textbox'), { target: { value: '  only after a reboot ' } });
    fireEvent.click(el.getByRole('button', { name: "Didn't work" }));
    await vi.waitFor(() => expect(a.attempt).toHaveBeenCalledWith({ solutionId: sol.id, outcome: 'failed', env: resp.query.env, note: 'only after a reboot' }));
    expect(await el.findByText(`worked ${sol.outcomes.worked + 1}`)).toBeTruthy();
    expect(el.getByRole('button', { name: 'Worked' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('votes and flags separately from outcomes', async () => {
    const a = fakeActions();
    await open(a);
    const el = within(solutionEl());
    fireEvent.click(el.getByRole('button', { name: 'Yes 0' }));
    expect(await el.findByRole('button', { name: 'Yes 1' })).toBeTruthy();
    expect(a.vote).toHaveBeenCalledWith({ solutionId: sol.id, helpful: true });
    fireEvent.click(el.getByRole('button', { name: 'Outdated' }));
    const flagged = await el.findByRole('button', { name: 'Outdated 1' });
    expect(flagged.hasAttribute('disabled')).toBe(true);
    expect(a.attempt).not.toHaveBeenCalled();
  });

  it("reports ChatGPT's answer on the fix it matches", async () => {
    const a = fakeActions();
    await open(a);
    const report = screen.getByText("Did ChatGPT's answer work for you?").closest('.sg-report') as HTMLElement;
    fireEvent.click(within(report).getByRole('button', { name: 'Worked' }));
    await vi.waitFor(() => expect(a.attempt).toHaveBeenCalledWith({ solutionId: sol.id, outcome: 'worked', env: resp.query.env }));
    expect(a.submit).not.toHaveBeenCalled();
  });

  it('shares a novel answer as a new fix before reporting on it', async () => {
    const novel = { ...resp, alignment: { verdict: 'novel' as const, problemId: null, solutionId: null, similarity: null } };
    const a = fakeActions(novel);
    await open(a);
    expect(screen.getByText(/Reporting shares this question and answer/)).toBeTruthy();
    const report = screen.getByText("Did ChatGPT's answer work for you?").closest('.sg-report') as HTMLElement;
    fireEvent.click(within(report).getByRole('button', { name: 'Partly' }));
    await vi.waitFor(() => expect(a.attempt).toHaveBeenCalledWith({ solutionId: 999, outcome: 'partial', env: resp.query.env }));
    expect(a.submit).toHaveBeenCalledWith(shareRequest(novel, req));
    expect(await screen.findByText(/^Shared as a new fix/)).toBeTruthy();
  });

  it('shows write errors next to the solution', async () => {
    const a = fakeActions();
    a.attempt.mockRejectedValueOnce(new Error('that fix no longer exists'));
    await open(a);
    fireEvent.click(within(solutionEl()).getByRole('button', { name: 'Worked' }));
    expect(await within(solutionEl()).findByRole('alert')).toBeTruthy();
  });

  it('shows a verify error with retry', async () => {
    const a = fakeActions();
    a.verify.mockRejectedValueOnce(new Error('API not reachable at http://localhost:8080'));
    render(<Check actions={a} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check with StackGPT' }));
    expect(await screen.findByText('StackGPT: API not reachable at http://localhost:8080')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(top.title)).toBeTruthy();
  });
});
