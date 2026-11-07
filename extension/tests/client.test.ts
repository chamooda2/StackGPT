import { describe, expect, it, vi } from 'vitest';
import type { Msg } from '../src/lib/api';
import { createClient, newToken, type TokenStore } from '../src/lib/client';

const verifyMsg: Msg = { type: 'verify', req: { platform: 'chatgpt', question: 'q', answer: { prose: 'a', codeBlocks: [], steps: [] } } };
const attemptMsg: Msg = { type: 'attempt', req: { solutionId: 1, outcome: 'worked' } };

function memStore(initial?: string): TokenStore & { value?: string } {
  const s: TokenStore & { value?: string } = {
    value: initial,
    get: async () => s.value,
    set: async t => void (s.value = t),
  };
  return s;
}

const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fakeFetch = (impl: () => Promise<Response>) => vi.fn<typeof fetch>(impl);
const tokenOf = (init: RequestInit | undefined) => (init!.headers as Record<string, string>)['X-StackGPT-Token'];

describe('newToken', () => {
  it('is 64 hex chars and random', () => {
    const t = newToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken()).not.toBe(t);
  });
});

describe('API client', () => {
  it('mints a token once, stores it and sends it on every call', async () => {
    const store = memStore();
    const fetchFn = fakeFetch(async () => ok({}));
    const call = createClient('http://api', store, fetchFn);
    await Promise.all([call(attemptMsg), call(attemptMsg)]);
    expect(store.value).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchFn.mock.calls.map(c => tokenOf(c[1]))).toEqual([store.value, store.value]);
  });

  it('reuses a valid stored token and replaces a malformed one', async () => {
    const good = 'a'.repeat(40);
    const fetchFn = fakeFetch(async () => ok({}));
    await createClient('http://api', memStore(good), fetchFn)(attemptMsg);
    expect(tokenOf(fetchFn.mock.calls[0]![1])).toBe(good);

    const bad = memStore('short');
    await createClient('http://api', bad, fakeFetch(async () => ok({})))(attemptMsg);
    expect(bad.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('routes each message to its endpoint', async () => {
    const fetchFn = fakeFetch(async () => ok({}));
    const call = createClient('http://api', memStore(), fetchFn);
    await call(verifyMsg);
    await call(attemptMsg);
    await call({ type: 'vote', req: { solutionId: 1, helpful: true } });
    await call({ type: 'flag', req: { solutionId: 1, kind: 'outdated' } });
    await call({ type: 'submit', req: { problemId: 1, body: 'b' } });
    expect(fetchFn.mock.calls.map(c => c[0])).toEqual([
      'http://api/v1/verify', 'http://api/v1/attempts', 'http://api/v1/votes', 'http://api/v1/flags', 'http://api/v1/solutions',
    ]);
  });

  it('caches verify and drops the cache after a write', async () => {
    const fetchFn = fakeFetch(async () => ok({ n: 1 }));
    const call = createClient('http://api', memStore(), fetchFn);
    expect(await call(verifyMsg)).toEqual({ ok: true, data: { n: 1 } });
    await call(verifyMsg);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await call(attemptMsg);
    await call(verifyMsg);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('maps failures to readable errors', async () => {
    const down = createClient('http://api', memStore(), vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await down(verifyMsg)).toEqual({ ok: false, error: 'API not reachable at http://api' });
    const gone = createClient('http://api', memStore(), vi.fn(async () => new Response('', { status: 404 })));
    expect(await gone(attemptMsg)).toEqual({ ok: false, error: 'that fix no longer exists' });
    const auth = createClient('http://api', memStore(), vi.fn(async () => new Response('', { status: 401 })));
    expect(await auth(attemptMsg)).toEqual({ ok: false, error: 'not signed in (anonymous token rejected)' });
  });
});
