import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Actions, SolutionSummary, VerifyRequest, VerifyResponse } from '../src/lib/api';
import { Check } from '../src/ui/Check';
import { headline, shareRequest } from '../src/ui/logic';
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

const open = async (a: Actions, data: VerifyResponse = resp) => {
  render(<Check actions={a} />);
  fireEvent.click(screen.getByRole('button', { name: /Check this answer/ }));
  await screen.findByText(headline(data));
};

const panel = () => document.querySelector('.sg-panel') as HTMLElement;
const report = () => within(document.querySelector('.sg-report') as HTMLElement);
const expandTop = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(top.title.slice(0, 30)) }));
const card = () => within(document.querySelector('.sg-sol') as HTMLElement);

afterEach(cleanup);

describe('Check panel', () => {
  it('sends nothing until the user clicks Check', () => {
    const a = fakeActions();
    render(<Check actions={a} />);
    expect(a.verify).not.toHaveBeenCalled();
  });

  it('leads with a verdict: trust, reasons, evidence, demo labelling and setup warnings', async () => {
    await open(fakeActions());
    const v = within(document.querySelector('.sg-verdict') as HTMLElement);
    expect(v.getByText('Conflicting results')).toBeTruthy();
    expect(v.getByText("ChatGPT's answer matches a fix the community has tested.")).toBeTruthy();
    expect(v.getByText(sol.trust.reasons[0]!, { exact: false })).toBeTruthy();
    expect(v.getByText(`${sol.outcomes.worked} worked`)).toBeTruthy();
    expect(v.getByText(/all demo data/)).toBeTruthy();
    expect(v.getByText(sol.conflicts[0]!)).toBeTruthy();
    const y = sol.yourEnv!;
    expect(v.getByText(`In setups like yours: ${y.worked} worked · ${y.partial} partly · ${y.failed} failed`)).toBeTruthy();
  });

  it('keeps similar problems collapsed when there is a verdict, and expands on click', async () => {
    await open(fakeActions());
    expect(document.querySelector('.sg-sol')).toBeNull();
    expandTop();
    expect(card().getByText('Same as this answer')).toBeTruthy();
  });

  it("reports ChatGPT's answer on the fix it matches", async () => {
    const a = fakeActions();
    await open(a);
    fireEvent.click(report().getByRole('button', { name: 'Worked' }));
    await vi.waitFor(() => expect(a.attempt).toHaveBeenCalledWith({ solutionId: sol.id, outcome: 'worked', env: resp.query.env }));
    expect(await report().findByText(/your report is counted/)).toBeTruthy();
    expect(a.submit).not.toHaveBeenCalled();
  });

  it('reports on a listed fix with an optional note and shows updated evidence', async () => {
    const a = fakeActions();
    await open(a);
    expandTop();
    fireEvent.click(card().getByRole('button', { name: 'Add context' }));
    fireEvent.input(card().getByRole('textbox'), { target: { value: '  only after a reboot ' } });
    fireEvent.click(card().getByRole('button', { name: "Didn't work" }));
    await vi.waitFor(() => expect(a.attempt).toHaveBeenCalledWith({ solutionId: sol.id, outcome: 'failed', env: resp.query.env, note: 'only after a reboot' }));
    expect(await card().findByText(`${sol.outcomes.worked + 1} worked`)).toBeTruthy();
    expect(card().getByRole('button', { name: 'Worked' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('votes and flags separately from outcomes', async () => {
    const a = fakeActions();
    await open(a);
    expandTop();
    fireEvent.click(card().getByRole('button', { name: 'Yes 0' }));
    expect(await card().findByRole('button', { name: 'Yes 1' })).toBeTruthy();
    expect(a.vote).toHaveBeenCalledWith({ solutionId: sol.id, helpful: true });
    fireEvent.click(card().getByRole('button', { name: 'Outdated' }));
    expect((await card().findByRole('button', { name: 'Outdated 1' })).hasAttribute('disabled')).toBe(true);
    expect(a.attempt).not.toHaveBeenCalled();
  });

  it('shares a novel answer as a new fix before reporting on it', async () => {
    const novel = { ...resp, alignment: { verdict: 'novel' as const, problemId: null, solutionId: null, similarity: null } };
    const a = fakeActions(novel);
    await open(a, novel);
    expect(within(panel()).getByText('No community evidence yet')).toBeTruthy();
    expect(report().getByText(/shares this question and answer/)).toBeTruthy();
    fireEvent.click(report().getByRole('button', { name: 'Partly' }));
    await vi.waitFor(() => expect(a.attempt).toHaveBeenCalledWith({ solutionId: 999, outcome: 'partial', env: resp.query.env }));
    expect(a.submit).toHaveBeenCalledWith(shareRequest(novel, req));
    expect(await report().findByText(/^Shared as a new fix/)).toBeTruthy();
  });

  it('shows write errors where the action happened', async () => {
    const a = fakeActions();
    a.attempt.mockRejectedValueOnce(new Error('that fix no longer exists'));
    await open(a);
    fireEvent.click(report().getByRole('button', { name: 'Worked' }));
    expect((await report().findByRole('alert')).textContent).toBe('that fix no longer exists');
  });

  it('collapses and expands the panel from the badge', async () => {
    await open(fakeActions());
    const badge = screen.getByRole('button', { expanded: true });
    fireEvent.click(badge);
    expect(panel()).toBeNull();
    expect(badge.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a verify error with retry', async () => {
    const a = fakeActions();
    a.verify.mockRejectedValueOnce(new Error('API not reachable at http://localhost:8080'));
    render(<Check actions={a} />);
    fireEvent.click(screen.getByRole('button', { name: /Check this answer/ }));
    expect(await screen.findByText('API not reachable at http://localhost:8080')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(headline(resp))).toBeTruthy();
  });
});
