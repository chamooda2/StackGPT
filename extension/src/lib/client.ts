import type { Msg, Reply } from './api';

const ROUTES: Record<Msg['type'], string> = {
  verify: '/v1/verify',
  attempt: '/v1/attempts',
  vote: '/v1/votes',
  flag: '/v1/flags',
  submit: '/v1/solutions',
};
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const TIMEOUT_MS = 20_000;
const CACHE_MAX = 50;

export interface TokenStore {
  get(): Promise<string | undefined>;
  set(t: string): Promise<void>;
}

/** 64 hex chars from the CSPRNG. */
export function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * API client used by the background worker. Sends the anonymous user token on every call, caches verify
 * responses (in-memory LRU) and drops the cache after any write, since writes change counts and "mine".
 */
export function createClient(api: string, store: TokenStore, fetchFn: typeof fetch = fetch) {
  const cache = new Map<string, unknown>();
  let token: Promise<string> | undefined;

  // Memoised so concurrent first calls don't mint two tokens (two users).
  const getToken = () =>
    (token ??= (async () => {
      const t = await store.get();
      if (t && TOKEN.test(t)) return t;
      const n = newToken();
      await store.set(n);
      return n;
    })());

  return async function call(msg: Msg): Promise<Reply<unknown>> {
    const body = JSON.stringify(msg.req);
    const write = msg.type !== 'verify';
    if (!write) {
      const hit = cache.get(body);
      if (hit) {
        cache.delete(body);
        cache.set(body, hit);
        return { ok: true, data: hit };
      }
    }
    let res: Response;
    try {
      res = await fetchFn(`${api}${ROUTES[msg.type]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-StackGPT-Token': await getToken() },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: `API not reachable at ${api}` };
    }
    if (!res.ok) return { ok: false, error: message(res.status) };
    const data: unknown = await res.json();
    if (write) cache.clear();
    else {
      cache.set(body, data);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return { ok: true, data };
  };
}

function message(status: number): string {
  if (status === 401) return 'not signed in (anonymous token rejected)';
  if (status === 404) return 'that fix no longer exists';
  if (status === 400) return 'request rejected as invalid';
  return `API error ${status}`;
}
