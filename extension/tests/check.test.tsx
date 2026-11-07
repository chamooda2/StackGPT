import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerifyResponse } from '../src/lib/api';
import { Check, headline } from '../src/ui/Check';
import recorded from './fixtures/verify-response.json';

// Recorded from the API: Galaxy A14 question whose answer matches a fix that mostly fails on the A14.
const resp = recorded as unknown as VerifyResponse;
const top = resp.matches[0]!;
const sol = top.solutions[0]!;
const withAlignment = (a: VerifyResponse['alignment']): VerifyResponse => ({ ...resp, alignment: a });

afterEach(cleanup);

const check = (load: () => Promise<VerifyResponse>) => {
  render(<Check load={load} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check with StackGPT' }));
};

describe('headline', () => {
  it('reports a matching fix with its outcomes and a fit warning', () => {
    const o = sol.outcomes;
    expect(headline(resp)).toBe(`StackGPT: matches a known fix (${o.worked} worked · ${o.partial} partial · ${o.failed} failed) · may not fit your setup`);
  });

  it('covers partial, novel, no answer and no matches', () => {
    expect(headline(withAlignment({ ...resp.alignment!, verdict: 'partial' }))).toMatch(/^StackGPT: partly overlaps a known fix \(/);
    expect(headline(withAlignment({ verdict: 'novel', problemId: null, solutionId: null, similarity: null }))).toBe(
      'StackGPT: 1 similar problem, but this fix has no evidence yet',
    );
    expect(headline(withAlignment(null))).toBe(`StackGPT: 1 similar problem · best match ${Math.round(top.similarity! * 100)}%`);
    expect(headline({ ...resp, matches: [] })).toBe('StackGPT: no similar problems found');
  });
});

describe('Check panel', () => {
  it('sends nothing until the user clicks Check', () => {
    const load = vi.fn(async () => resp);
    render(<Check load={load} />);
    expect(screen.getByRole('button', { name: 'Check with StackGPT' })).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
  });

  it('shows the aligned fix, outcomes in the user setup, conflicts and synthetic labelling', async () => {
    check(async () => resp);
    expect(await screen.findByText(headline(resp))).toBeTruthy();
    expect(screen.getByText(top.title)).toBeTruthy();
    expect(screen.getByText(`Same fix as this answer (${Math.round(resp.alignment!.similarity! * 100)}%)`)).toBeTruthy();
    expect(screen.getByText(/^In setups like yours:/).textContent).toBe(
      `In setups like yours: worked ${sol.yourEnv!.worked} · partial ${sol.yourEnv!.partial} · failed ${sol.yourEnv!.failed} (${sol.yourEnv!.synthetic} of 10 synthetic)`,
    );
    expect(screen.getByText(sol.conflicts[0]!)).toBeTruthy();
    expect(screen.getByText(/Galaxy A14/, { selector: '.sg-query div' })).toBeTruthy();
  });

  it('hides "in setups like yours" when it would repeat all reports', async () => {
    const same = structuredClone(resp);
    same.matches[0]!.solutions[0]!.yourEnv = { ...sol.outcomes };
    check(async () => same);
    await screen.findByText(top.title);
    expect(screen.queryByText(/^In setups like yours:/)).toBeNull();
  });

  it('collapses and expands the panel from the badge', async () => {
    check(async () => resp);
    const badge = await screen.findByRole('button', { expanded: true });
    fireEvent.click(badge);
    expect(screen.queryByText(top.title)).toBeNull();
    expect(badge.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows an error with retry when the API fails', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('API not reachable at http://localhost:8080')).mockResolvedValueOnce(resp);
    check(load);
    expect(await screen.findByText('StackGPT: API not reachable at http://localhost:8080')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(top.title)).toBeTruthy();
  });
});
