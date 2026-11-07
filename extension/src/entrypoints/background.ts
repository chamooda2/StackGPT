import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { Msg, Reply, VerifyRequest, VerifyResponse } from '../lib/api';

const API = import.meta.env.WXT_API_BASE ?? 'http://localhost:8080';
const TIMEOUT_MS = 20_000;
const CACHE_MAX = 50;

// In-memory LRU (Map keeps insertion order). Lost when the worker sleeps, which is fine for a cache.
const cache = new Map<string, VerifyResponse>();

async function verify(req: VerifyRequest): Promise<Reply<VerifyResponse>> {
  const key = JSON.stringify(req);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return { ok: true, data: hit };
  }
  let res: Response;
  try {
    res = await fetch(`${API}/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: key,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: `API not reachable at ${API}` };
  }
  if (!res.ok) return { ok: false, error: `API error ${res.status}` };
  const data = (await res.json()) as VerifyResponse;
  cache.set(key, data);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return { ok: true, data };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: Msg, _sender, send) => {
    if (msg?.type !== 'verify') return;
    verify(msg.req).then(send);
    return true;
  });
});
