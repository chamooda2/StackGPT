// Deterministic synthetic attempt generation for curated seed data.
// Every generated attempt is stored with synthetic = true.

export type Outcome = 'worked' | 'partial' | 'failed';
export type Env = Record<string, unknown>;
export type Profile = 'verified' | 'partial' | 'conflicting' | 'outdated' | 'failing' | 'unverified';
export type Evidence = { profile: Profile; env?: Env; works?: Env; fails?: Env };
export type Attempt = { outcome: Outcome; env: Env; daysAgo: number; user: number };

// w/p/f = exact worked/partial/failed counts; days = [min, max] days ago (max clamped to solution age).
type Seg = { w: number; p: number; f: number; days: [number, number]; env?: Env };

const SEGS: Record<Profile, (e: Evidence) => Seg[]> = {
  verified: e => [{ w: 19, p: 1, f: 0, days: [3, 180], env: e.env }],
  partial: e => [{ w: 5, p: 4, f: 3, days: [5, 300], env: e.env }],
  conflicting: e => [
    { w: 9, p: 0, f: 1, days: [3, 240], env: e.works },
    { w: 1, p: 1, f: 8, days: [3, 240], env: e.fails },
  ],
  outdated: e => [
    { w: 10, p: 1, f: 0, days: [400, 1500], env: e.env },
    { w: 0, p: 1, f: 6, days: [2, 90], env: e.env },
  ],
  failing: e => [{ w: 1, p: 1, f: 8, days: [5, 300], env: e.env }],
  unverified: e => [{ w: 1, p: 0, f: 0, days: [10, 300], env: e.env }],
};

const isObj = (v: unknown): v is Env => typeof v === 'object' && v !== null && !Array.isArray(v);

// Shallow merge, one level deep for nested objects (e.g. pkg versions).
export const merge = (a: Env, b: Env = {}): Env => {
  const o: Env = { ...a, ...b };
  for (const k of Object.keys(b)) if (isObj(a[k]) && isObj(b[k])) o[k] = { ...a[k], ...b[k] };
  return o;
};

// FNV-1a 32-bit
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

// mulberry32 PRNG, returns floats in [0, 1)
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Attempts for one solution. Same key -> same output. Users are distinct indices in [0, pool).
// Time/space: O(pool + n), n = attempts generated.
export function genAttempts(key: string, ev: Evidence, base: Env, ageDays: number, pool: number): Attempt[] {
  if (!SEGS[ev.profile]) throw new Error(`${key}: unknown profile '${ev.profile}'`);
  if (ev.profile === 'conflicting' && (!ev.works || !ev.fails)) throw new Error(`${key}: conflicting needs works and fails env`);
  const r = rng(hash(key));
  const segs = SEGS[ev.profile](ev);
  const n = segs.reduce((s, g) => s + g.w + g.p + g.f, 0);
  if (n > pool) throw new Error(`${key}: needs ${n} users, pool has ${pool}`);

  const users = [...Array(pool).keys()];
  for (let i = pool - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [users[i], users[j]] = [users[j], users[i]];
  }

  const out: Attempt[] = [];
  let u = 0;
  for (const g of segs) {
    const [lo, max] = g.days;
    if (lo >= ageDays) throw new Error(`${key}: solution is ${ageDays}d old, '${ev.profile}' needs attempts ${lo}d ago`);
    const hi = Math.min(max, ageDays - 1);
    const env = merge(base, g.env);
    const outs: Outcome[] = [...Array(g.w).fill('worked'), ...Array(g.p).fill('partial'), ...Array(g.f).fill('failed')];
    for (const outcome of outs) out.push({ outcome, env, daysAgo: lo + Math.floor(r() * (hi - lo + 1)), user: users[u++] });
  }
  return out;
}
