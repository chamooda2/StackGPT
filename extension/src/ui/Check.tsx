import { useState } from 'preact/hooks';
import type { Alignment, Match, Outcomes, Solution, Source, VerifyResponse } from '../lib/api';

type State = { k: 'idle' } | { k: 'loading' } | { k: 'ok'; data: VerifyResponse } | { k: 'error'; msg: string };

const SHOW = 5;
const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const rank = (r: number | null) => (r == null ? '–' : `#${r}`);
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const total = (o: Outcomes) => o.worked + o.partial + o.failed;

function aligned(d: VerifyResponse): Solution | undefined {
  const id = d.alignment?.solutionId;
  return id == null ? undefined : d.matches.flatMap(m => m.solutions).find(s => s.id === id);
}

/** One-line summary on the badge: does this answer's fix have community evidence? */
export function headline(d: VerifyResponse): string {
  const n = d.matches.length;
  if (n === 0) return 'StackGPT: no similar problems found';
  const a = d.alignment;
  const s = aligned(d);
  const o = s?.outcomes;
  const counts = o ? ` (${o.worked} worked · ${o.partial} partial · ${o.failed} failed)` : '';
  const fits = s && s.conflicts.length > 0 ? ' · may not fit your setup' : '';
  if (a?.verdict === 'matches') return `StackGPT: matches a known fix${counts}${fits}`;
  if (a?.verdict === 'partial') return `StackGPT: partly overlaps a known fix${counts}${fits}`;
  if (a?.verdict === 'novel') return `StackGPT: ${plural(n, 'similar problem')}, but this fix has no evidence yet`;
  return `StackGPT: ${plural(n, 'similar problem')} · best match ${pct(d.matches[0]!.similarity)}`;
}

/** Badge under an answer. Nothing leaves the page until the user clicks Check. */
export function Check({ load }: { load: () => Promise<VerifyResponse> }) {
  const [s, setS] = useState<State>({ k: 'idle' });
  const [open, setOpen] = useState(true);

  const run = async () => {
    setS({ k: 'loading' });
    try {
      setS({ k: 'ok', data: await load() });
      setOpen(true);
    } catch (e) {
      setS({ k: 'error', msg: e instanceof Error ? e.message : String(e) });
    }
  };

  if (s.k === 'idle' || s.k === 'loading')
    return (
      <div class="sg">
        <button class="sg-badge" onClick={run} disabled={s.k === 'loading'}
          title="Sends this question and answer to StackGPT to look for community evidence">
          {s.k === 'loading' ? 'Checking…' : 'Check with StackGPT'}
        </button>
      </div>
    );

  if (s.k === 'error')
    return (
      <div class="sg">
        <span class="sg-badge sg-err" role="alert">StackGPT: {s.msg}</span>
        <button class="sg-link" onClick={run}>Retry</button>
      </div>
    );

  const d = s.data;
  return (
    <div class="sg">
      <button class={`sg-badge sg-v-${d.alignment?.verdict ?? 'none'}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {headline(d)}
      </button>
      {open && (
        <div class="sg-panel">
          {d.matches.slice(0, SHOW).map(m => <MatchView key={m.problemId} m={m} al={d.alignment} />)}
          <details class="sg-query">
            <summary>What was searched</summary>
            <div>Error signatures: {d.query.errorSigs.length ? d.query.errorSigs.join(', ') : 'none'}</div>
            <div>Environment: {Object.keys(d.query.env).length ? JSON.stringify(d.query.env) : 'none detected'}</div>
          </details>
        </div>
      )}
    </div>
  );
}

function MatchView({ m, al }: { m: Match; al: Alignment | null }) {
  return (
    <section class="sg-match">
      <h3>{m.title}</h3>
      <div class="sg-meta">
        <span>{m.domain}</span>
        <span>similarity {pct(m.similarity)}</span>
        <span title="How well this problem's environment fits yours (50% = nothing to compare)">env fit {pct(m.fit.score)}</span>
        <span title="Rank in vector / full-text / error-signature search">
          ranks: vector {rank(m.ranks.vector)} · text {rank(m.ranks.text)} · error {rank(m.ranks.errorSig)}
        </span>
      </div>
      {m.fit.conflicts.map(c => <div key={c} class="sg-conflict">{c}</div>)}
      {m.solutions.map(s => <SolutionView key={s.id} s={s} same={al?.solutionId === s.id ? al : null} />)}
      <Attribution src={m.source} />
    </section>
  );
}

function SolutionView({ s, same }: { s: Solution; same: Alignment | null }) {
  return (
    <div class={`sg-sol${same ? ' sg-same' : ''}`}>
      {same && (
        <div class="sg-tag">
          {same.verdict === 'matches' ? 'Same fix as this answer' : 'Overlaps with this answer'} ({pct(same.similarity)})
        </div>
      )}
      <p>{clip(s.body)}</p>
      <OutcomeLine label="All reports" o={s.outcomes} />
      {s.yourEnv && total(s.yourEnv) < total(s.outcomes) && <OutcomeLine label="In setups like yours" o={s.yourEnv} />}
      {s.conflicts.map(c => <div key={c} class="sg-conflict">{c}</div>)}
    </div>
  );
}

function OutcomeLine({ label, o }: { label: string; o: Outcomes }) {
  const n = total(o);
  if (n === 0) return <div class="sg-out">{label}: none yet</div>;
  return (
    <div class="sg-out">
      {label}: <span class="sg-w">worked {o.worked}</span> · <span class="sg-p">partial {o.partial}</span> ·{' '}
      <span class="sg-f">failed {o.failed}</span>
      {o.synthetic > 0 && <span class="sg-syn" title="Seeded demo data, not real user reports"> ({o.synthetic} of {n} synthetic)</span>}
    </div>
  );
}

function Attribution({ src }: { src: Source }) {
  const who = [src.author, src.license].filter(Boolean).join(' · ');
  return (
    <div class="sg-src">
      Source: {src.url ? <a href={src.url} target="_blank" rel="noopener noreferrer">{src.name}</a> : src.name}
      {who && ` — ${who}`}
    </div>
  );
}
