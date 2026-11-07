import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerifyResponse } from '../src/lib/api';
import { Check } from '../src/ui/Check';
import recorded from './fixtures/verify-response.json';

const resp = recorded as unknown as VerifyResponse;
const top = resp.matches[0]!;

afterEach(cleanup);

describe('Check panel', () => {
  it('sends nothing until the user clicks Check', () => {
    const load = vi.fn(async () => resp);
    render(<Check load={load} />);
    expect(screen.getByRole('button', { name: 'Check with StackGPT' })).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
  });

  it('shows matches, outcome counts, synthetic labelling and what was searched', async () => {
    render(<Check load={async () => resp} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check with StackGPT' }));

    const n = resp.matches.length;
    const best = Math.round(top.similarity! * 100);
    expect(await screen.findByText(`StackGPT: ${n} similar problems · best match ${best}%`)).toBeTruthy();
    expect(screen.getByText(top.title)).toBeTruthy();
    expect(screen.getAllByText('worked 19').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/of 20 synthetic/).length).toBeGreaterThan(0);
    expect(screen.getByText(/externally-managed-environment/, { selector: '.sg-query div' })).toBeTruthy();
  });

  it('collapses and expands the panel from the badge', async () => {
    render(<Check load={async () => resp} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check with StackGPT' }));
    const badge = await screen.findByRole('button', { expanded: true });
    fireEvent.click(badge);
    expect(screen.queryByText(top.title)).toBeNull();
    expect(badge.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows an error with retry when the API fails', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('API not reachable at http://localhost:8080')).mockResolvedValueOnce(resp);
    render(<Check load={load} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check with StackGPT' }));
    expect(await screen.findByText('StackGPT: API not reachable at http://localhost:8080')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(top.title)).toBeTruthy();
  });

  it('says so when nothing similar is found', async () => {
    render(<Check load={async () => ({ query: { statement: 'x', errorSigs: [], env: {} }, matches: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check with StackGPT' }));
    expect(await screen.findByText('StackGPT: no similar problems found')).toBeTruthy();
  });
});
