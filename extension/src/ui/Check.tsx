import { useState } from 'preact/hooks';
import type { Match, Outcomes, Solution, Source, VerifyResponse } from '../lib/api';

type State = { k: 'idle' } | { k: 'loading' } | { k: 'ok'; data: VerifyResponse } | { k: 'error'; msg: string };

const SHOW = 5;
const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const rank = (r: number | null) => (r == null ? '–' : `#${r}`);
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);

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

  const { matches, query } = s.data;
  const best = matches[0]?.similarity ?? null;
  return (
    <div class="sg">
      <button class="sg-badge" aria-expanded={open} onClick={() => setOpen(!open)}>
        {matches.length === 0
          ? 'StackGPT: no similar problems found'
          : `StackGPT: ${matches.length} similar problem${matches.length > 1 ? 's' : ''} · best match ${pct(best)}`}
      </button>
      {open && (
        <div class="sg-panel">
          {matches.slice(0, SHOW).map(m => <MatchView key={m.problemId} m={m} />)}
          <details class="sg-query">
            <summary>What was searched</summary>
            <div>Error signatures: {query.errorSigs.length ? query.errorSigs.join(', ') : 'none'}</div>
            <div>Environment: {Object.keys(query.env).length ? JSON.stringify(query.env) : 'none detected'}</div>
          </details>
        </div>
      )}
    </div>
  );
}

function MatchView({ m }: { m: Match }) {
  return (
    <section class="sg-match">
      <h3>{m.title}</h3>
      <div class="sg-meta">
        <span>{m.domain}</span>
        <span>similarity {pct(m.similarity)}</span>
        <span title="Rank in vector / full-text / error-signature search">
          ranks: vector {rank(m.ranks.vector)} · text {rank(m.ranks.text)} · error {rank(m.ranks.errorSig)}
        </span>
      </div>
      {m.solutions.map(s => <SolutionView key={s.id} s={s} />)}
      <Attribution src={m.source} />
    </section>
  );
}

function SolutionView({ s }: { s: Solution }) {
  return (
    <div class="sg-sol">
      <p>{clip(s.body)}</p>
      <OutcomeLine o={s.outcomes} />
    </div>
  );
}

function OutcomeLine({ o }: { o: Outcomes }) {
  const n = o.worked + o.partial + o.failed;
  if (n === 0) return <div class="sg-out">No reports yet</div>;
  return (
    <div class="sg-out">
      <span class="sg-w">worked {o.worked}</span> · <span class="sg-p">partial {o.partial}</span> ·{' '}
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
