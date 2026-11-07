import { useState } from 'preact/hooks';
import type {
  Actions, Alignment, FlagKind, Match, Outcome, Outcomes, Solution, SolutionSummary, Source, SubmitRequest, Trust,
  TrustStatus, VerifyRequest, VerifyResponse,
} from '../lib/api';

type State =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'ok'; data: VerifyResponse; req: VerifyRequest }
  | { k: 'error'; msg: string };

const SHOW = 5;
/** A shared answer is filed under the top match only when it is clearly the same problem. */
export const SAME_PROBLEM = 0.85;
const OUTCOMES: [Outcome, string][] = [['worked', 'Worked'], ['partial', 'Partly'], ['failed', "Didn't work"]];
const TRUST_LABEL: Record<TrustStatus, string> = {
  verified: 'Verified', conflicting: 'Conflicting', outdated: 'Outdated', partial: 'Mixed results', failing: 'Mostly fails',
  unverified: 'Unverified',
};
const TRUST_PHRASE: Record<TrustStatus, string> = {
  verified: 'a verified fix', conflicting: 'a fix with conflicting results', outdated: 'an outdated fix',
  partial: 'a fix with mixed results', failing: 'a fix that mostly fails', unverified: 'an unverified fix',
};

const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const rank = (r: number | null) => (r == null ? '–' : `#${r}`);
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const total = (o: Outcomes) => o.worked + o.partial + o.failed;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function aligned(d: VerifyResponse): Solution | undefined {
  const id = d.alignment?.solutionId;
  return id == null ? undefined : d.matches.flatMap(m => m.solutions).find(s => s.id === id);
}

/** One-line summary on the badge: does this answer's fix have community evidence, and how good is it? */
export function headline(d: VerifyResponse): string {
  const n = d.matches.length;
  if (n === 0) return 'StackGPT: no similar problems found';
  const a = d.alignment;
  const s = aligned(d);
  const o = s?.outcomes;
  const counts = o ? ` (${o.worked} worked · ${o.partial} partial · ${o.failed} failed)` : '';
  const fits = s && s.conflicts.length > 0 ? ' · may not fit your setup' : '';
  const fix = s ? TRUST_PHRASE[s.trust.status] : 'a known fix';
  if (a?.verdict === 'matches') return `StackGPT: matches ${fix}${counts}${fits}`;
  if (a?.verdict === 'partial') return `StackGPT: partly overlaps ${fix}${counts}${fits}`;
  if (a?.verdict === 'novel') return `StackGPT: ${plural(n, 'similar problem')}, but this fix has no evidence yet`;
  return `StackGPT: ${plural(n, 'similar problem')} · best match ${pct(d.matches[0]!.similarity)}`;
}

/** Replaces one solution's community evidence with the summary a write returned. */
export function patch(d: VerifyResponse, s: SolutionSummary): VerifyResponse {
  return {
    ...d,
    trustStatus: d.alignment?.solutionId === s.id ? s.trust.status : d.trustStatus,
    matches: d.matches.map(m => ({
      ...m,
      solutions: m.solutions.map(x =>
        x.id === s.id ? { ...x, outcomes: s.outcomes, trust: s.trust, votes: s.votes, flags: s.flags, mine: s.mine } : x,
      ),
    })),
  };
}

/** Request that shares the AI answer as a new fix: under the top match if it is the same problem, else a new one. */
export function shareRequest(d: VerifyResponse, req: VerifyRequest): SubmitRequest {
  const top = d.matches[0];
  const same = top && (top.similarity ?? 0) >= SAME_PROBLEM && top.fit.conflicts.length === 0;
  const a = req.answer;
  const code = a.codeBlocks.map(c => c.code).join('\n\n');
  return {
    ...(same ? { problemId: top.problemId } : { problem: { title: req.question.split('\n')[0]!.slice(0, 300), body: req.question.slice(0, 20_000) } }),
    body: (a.prose || a.steps.join('\n')).slice(0, 20_000),
    steps: a.steps.slice(0, 50),
    ...(code ? { code: code.slice(0, 20_000) } : {}),
  };
}

/** Badge under an answer. Nothing leaves the page until the user clicks Check. */
export function Check({ actions }: { actions: Actions }) {
  const [s, setS] = useState<State>({ k: 'idle' });
  const [open, setOpen] = useState(true);

  const run = async () => {
    setS({ k: 'loading' });
    try {
      const { req, resp } = await actions.verify();
      setS({ k: 'ok', data: resp, req });
      setOpen(true);
    } catch (e) {
      setS({ k: 'error', msg: errText(e) });
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
  const update = (x: SolutionSummary) => setS(cur => (cur.k === 'ok' ? { ...cur, data: patch(cur.data, x) } : cur));
  return (
    <div class="sg">
      <button class={`sg-badge sg-v-${d.alignment?.verdict ?? 'none'}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {headline(d)}
      </button>
      {open && (
        <div class="sg-panel">
          {d.alignment && <ReportAnswer d={d} req={s.req} actions={actions} onUpdate={update} />}
          {d.matches.slice(0, SHOW).map(m => <MatchView key={m.problemId} m={m} d={d} actions={actions} onUpdate={update} />)}
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

/** "Did ChatGPT's answer work?": reports on the aligned fix, or shares the answer as a new fix first. */
function ReportAnswer({ d, req, actions, onUpdate }: { d: VerifyResponse; req: VerifyRequest; actions: Actions; onUpdate: (s: SolutionSummary) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shared, setShared] = useState<SolutionSummary | null>(null);
  const s = d.alignment?.verdict === 'matches' ? aligned(d) : undefined;
  const mine = s?.mine.outcome ?? shared?.mine.outcome ?? null;

  const report = async (outcome: Outcome) => {
    setBusy(true);
    setErr(null);
    try {
      if (s) onUpdate(await actions.attempt({ solutionId: s.id, outcome, env: d.query.env }));
      else {
        const id = shared?.id ?? (await actions.submit(shareRequest(d, req))).id;
        setShared(await actions.attempt({ solutionId: id, outcome, env: d.query.env }));
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sg-report">
      <div class="sg-fb">
        <span>Did ChatGPT's answer work for you?</span>
        {OUTCOMES.map(([o, label]) => (
          <button key={o} class="sg-btn" aria-pressed={mine === o} disabled={busy} onClick={() => report(o)}>{label}</button>
        ))}
      </div>
      {!s && !shared && <div class="sg-note">Reporting shares this question and answer with StackGPT as a new fix.</div>}
      {shared && <div class="sg-note">Shared as a new fix · {TRUST_LABEL[shared.trust.status]} ({plural(shared.trust.reports, 'report')})</div>}
      {err && <div class="sg-conflict" role="alert">{err}</div>}
    </div>
  );
}

function MatchView({ m, d, actions, onUpdate }: { m: Match; d: VerifyResponse; actions: Actions; onUpdate: (s: SolutionSummary) => void }) {
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
      {m.solutions.map(s => (
        <SolutionView key={s.id} s={s} env={d.query.env} same={d.alignment?.solutionId === s.id ? d.alignment : null} actions={actions} onUpdate={onUpdate} />
      ))}
      <Attribution src={m.source} />
    </section>
  );
}

function SolutionView({ s, env, same, actions, onUpdate }: {
  s: Solution; env: Record<string, unknown>; same: Alignment | null; actions: Actions; onUpdate: (s: SolutionSummary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const act = async (f: () => Promise<SolutionSummary>) => {
    setBusy(true);
    setErr(null);
    try {
      onUpdate(await f());
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const report = (outcome: Outcome) => act(() => actions.attempt({ solutionId: s.id, outcome, env, ...(note.trim() ? { note: note.trim() } : {}) }));
  const flag = (kind: FlagKind) => act(() => actions.flag({ solutionId: s.id, kind }));

  return (
    <div class={`sg-sol${same ? ' sg-same' : ''}`}>
      {same && (
        <div class="sg-tag">
          {same.verdict === 'matches' ? 'Same fix as this answer' : 'Overlaps with this answer'} ({pct(same.similarity)})
        </div>
      )}
      <TrustLine t={s.trust} />
      <p>{clip(s.body)}</p>
      <OutcomeLine label="All reports" o={s.outcomes} />
      {s.yourEnv && total(s.yourEnv) < total(s.outcomes) && <OutcomeLine label="In setups like yours" o={s.yourEnv} />}
      {s.conflicts.map(c => <div key={c} class="sg-conflict">{c}</div>)}
      <div class="sg-fb">
        <span>Did this work for you?</span>
        {OUTCOMES.map(([o, label]) => (
          <button key={o} class="sg-btn" aria-pressed={s.mine.outcome === o} disabled={busy} onClick={() => report(o)}>{label}</button>
        ))}
        <button class="sg-link" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>Add context</button>
      </div>
      {noteOpen && (
        <textarea class="sg-text" maxLength={2000} value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)}
          placeholder="What happened? Versions, device, error message… Sent with your next Worked / Partly / Didn't work." />
      )}
      <div class="sg-fb sg-small">
        <span>Helpful?</span>
        <button class="sg-btn" aria-pressed={s.mine.helpful === true} disabled={busy} onClick={() => act(() => actions.vote({ solutionId: s.id, helpful: true }))}>
          Yes {s.votes.helpful}
        </button>
        <button class="sg-btn" aria-pressed={s.mine.helpful === false} disabled={busy} onClick={() => act(() => actions.vote({ solutionId: s.id, helpful: false }))}>
          No {s.votes.notHelpful}
        </button>
        <span>Flag:</span>
        <button class="sg-btn" aria-pressed={s.mine.flags.includes('outdated')} disabled={busy || s.mine.flags.includes('outdated')} onClick={() => flag('outdated')}>
          Outdated{s.flags.outdated ? ` ${s.flags.outdated}` : ''}
        </button>
        <button class="sg-btn" aria-pressed={s.mine.flags.includes('misleading')} disabled={busy || s.mine.flags.includes('misleading')} onClick={() => flag('misleading')}>
          Misleading{s.flags.misleading ? ` ${s.flags.misleading}` : ''}
        </button>
      </div>
      {err && <div class="sg-conflict" role="alert">{err}</div>}
    </div>
  );
}

function TrustLine({ t }: { t: Trust }) {
  return (
    <div class="sg-trust-line">
      <span class={`sg-trust sg-t-${t.status}`}>{TRUST_LABEL[t.status]}</span>
      {t.synthetic && <span class="sg-syn" title="Includes seeded demo reports"> demo data</span>}
      <span class="sg-reason"> {t.reasons.join(' · ')}</span>
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
