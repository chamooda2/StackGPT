import type { Answer, SiteAdapter } from './adapter';

/** An answer is done once its text is non-empty, unchanged for `ms`, and the site stopped generating. */
export class Stability {
  private seen = new Map<string, { text: string; since: number }>();

  constructor(private readonly ms = 1500) {}

  check(id: string, text: string, now: number, generating: boolean): boolean {
    const s = this.seen.get(id);
    if (!s || s.text !== text) {
      this.seen.set(id, { text, since: now });
      return false;
    }
    return text.trim() !== '' && !generating && now - s.since >= this.ms;
  }
}

export interface WatchOpts {
  debounceMs: number;
  stableMs: number;
  tickMs: number;
}

const DEFAULTS: WatchOpts = { debounceMs: 250, stableMs: 1500, tickMs: 500 };

/**
 * Calls `ready(a)` on every scan for each finished answer (callers make it idempotent, which also lets
 * them re-mount UI the site's re-renders removed). One coalescing MutationObserver triggers scans;
 * while answers are still pending a timer keeps re-checking, because streaming can end without further
 * mutations. Each scan is O(answers). Returns a stop function.
 */
export function watch(doc: Document, site: SiteAdapter, ready: (a: Answer) => void, opts: Partial<WatchOpts> = {}): () => void {
  const o = { ...DEFAULTS, ...opts };
  const st = new Stability(o.stableMs);
  const done = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (ms: number) => {
    if (timer === undefined) timer = setTimeout(scan, ms);
  };

  function scan() {
    timer = undefined;
    let pending = false;
    for (const a of site.answers(doc)) {
      if (!done.has(a.id)) {
        if (!st.check(a.id, a.content.textContent ?? '', Date.now(), site.generating(a, doc))) {
          pending = true;
          continue;
        }
        done.add(a.id);
      }
      ready(a);
    }
    if (pending) schedule(o.tickMs);
  }

  const mo = new MutationObserver(() => schedule(o.debounceMs));
  mo.observe(doc.body, { childList: true, subtree: true, characterData: true });
  schedule(0);
  return () => {
    mo.disconnect();
    clearTimeout(timer);
  };
}
