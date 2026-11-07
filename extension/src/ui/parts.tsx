import { useState } from 'preact/hooks';
import type {
  Actions, Alignment, FlagKind, Match, Outcome, Outcomes, Solution, SolutionSummary, Source, Trust, VerifyRequest,
  VerifyResponse,
} from '../lib/api';
import { aligned, errText, pct, plural, shareRequest, STATUS, total } from './logic';

const OUTCOMES: [Outcome, string][] = [['worked', 'Worked'], ['partial', 'Partly'], ['failed', "Didn't work"]];

/** Small disclosure chevron: points right when closed, down when open. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg class={`sg-chev${open ? ' sg-chev-open' : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
const clip = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s);
const rank = (r: number | null) => (r == null ? '–' : `#${r}`);

/** Top card: what the evidence says about ChatGPT's answer. */
export function Verdict({ d }: { d: VerifyResponse }) {
  const s = aligned(d);
  if (!s) {
    const title = d.alignment?.verdict === 'novel' ? 'No community evidence yet' : d.matches.length ? 'Related problems found' : 'No similar problems found';
    const body = d.alignment?.verdict === 'novel'
      ? `This answer doesn't match any fix the community has tested.${d.matches.length ? ' Similar problems below may still help.' : ''}`
      : d.matches.length ? 'Community fixes for similar problems are listed below.' : 'Nobody has reported on a problem like this yet.';
    return (
      <section class="sg-verdict sg-tone-muted">
        <div class="sg-verdict-title">{title}</div>
        <p class="sg-muted">{body}</p>
      </section>
    );
  }
  const st = STATUS[s.trust.status];
  const lead = d.alignment!.verdict === 'matches' ? "ChatGPT's answer matches a fix the community has tested." : "ChatGPT's answer is similar to a fix the community has tested.";
  return (
    <section class={`sg-verdict sg-tone-${st.tone}`}>
      <div class="sg-verdict-title">
        <TrustChip t={s.trust} />
        <span class="sg-muted">{lead}</span>
      </div>
      <p>{st.blurb} <span class="sg-muted">{s.trust.reasons.join(' · ')}</span></p>
      <EvidenceBar o={s.outcomes} />
      <SetupNotes s={s} />
    </section>
  );
}

/** Warnings and outcomes specific to the user's environment. */
function SetupNotes({ s }: { s: Solution }) {
  const yours = s.yourEnv && total(s.yourEnv) < total(s.outcomes) ? s.yourEnv : null;
  if (!yours && s.conflicts.length === 0) return null;
  return (
    <div class="sg-setup">
      {s.conflicts.map(c => <div key={c} class="sg-warn-line">{c}</div>)}
      {yours && (
        <div class="sg-muted">
          In setups like yours: {yours.worked} worked · {yours.partial} partly · {yours.failed} failed
        </div>
      )}
    </div>
  );
}

export function TrustChip({ t }: { t: Trust }) {
  const st = STATUS[t.status];
  return <span class={`sg-chip sg-tone-${st.tone}`} title={t.reasons.join('\n')}>{st.label}</span>;
}

/** Stacked worked/partly/failed bar with counts; flags seeded demo reports. */
export function EvidenceBar({ o }: { o: Outcomes }) {
  const n = total(o);
  if (n === 0) return <div class="sg-muted sg-small">No reports yet</div>;
  const w = (x: number) => `${(100 * x) / n}%`;
  return (
    <div class="sg-evidence">
      <div class="sg-bar" role="img" aria-label={`${o.worked} worked, ${o.partial} partly, ${o.failed} failed`}>
        <span class="sg-bar-w" style={{ width: w(o.worked) }} />
        <span class="sg-bar-p" style={{ width: w(o.partial) }} />
        <span class="sg-bar-f" style={{ width: w(o.failed) }} />
      </div>
      <div class="sg-small">
        <span class="sg-c-ok">{o.worked} worked</span> · <span class="sg-c-warn">{o.partial} partly</span> ·{' '}
        <span class="sg-c-bad">{o.failed} failed</span>
        {o.synthetic > 0 && (
          <span class="sg-demo" title="Seeded demonstration data, not real user reports">
            {' '}· {o.synthetic === n ? 'all' : `${o.synthetic} of ${n}`} demo data
          </span>
        )}
      </div>
    </div>
  );
}

function OutcomeButtons({ mine, busy, onReport }: { mine: Outcome | null; busy: boolean; onReport: (o: Outcome) => void }) {
  return (
    <>
      {OUTCOMES.map(([o, label]) => (
        <button key={o} class={`sg-btn sg-btn-${o}`} aria-pressed={mine === o} disabled={busy} onClick={() => onReport(o)}>{label}</button>
      ))}
    </>
  );
}

/** "Did ChatGPT's answer work?": reports on the aligned fix, or shares the answer as a new fix first. */
export function ReportAnswer({ d, req, actions, onUpdate }: { d: VerifyResponse; req: VerifyRequest; actions: Actions; onUpdate: (s: SolutionSummary) => void }) {
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
    <section class="sg-report">
      <div class="sg-row">
        <span class="sg-strong">Did ChatGPT's answer work for you?</span>
        <OutcomeButtons mine={mine} busy={busy} onReport={report} />
      </div>
      {!s && !shared && <div class="sg-muted sg-small">Your report shares this question and answer with StackGPT as a new fix, so others can learn from it.</div>}
      {s && !mine && <div class="sg-muted sg-small">Reports are anonymous and help others decide whether to trust this fix.</div>}
      {mine && <div class="sg-muted sg-small">Thanks, your report is counted. Click another option to change it.</div>}
      {shared && <div class="sg-muted sg-small">Shared as a new fix · {STATUS[shared.trust.status].label} ({plural(shared.trust.reports, 'report')})</div>}
      {err && <div class="sg-warn-line" role="alert">{err}</div>}
    </section>
  );
}

/** One similar problem: collapsed summary row, expandable to its fixes. */
export function MatchItem({ m, d, actions, onUpdate, initiallyOpen }: {
  m: Match; d: VerifyResponse; actions: Actions; onUpdate: (s: SolutionSummary) => void; initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const best = m.solutions[0];
  const id = `sg-m-${m.problemId}`;
  return (
    <div class="sg-match">
      <button class="sg-match-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <span class="sg-match-title">{m.title}</span>
        {best && <TrustChip t={best.trust} />}
        <span class="sg-muted sg-small">{plural(m.solutions.length, 'fix')}</span>
      </button>
      {m.fit.conflicts.map(c => <div key={c} class="sg-warn-line sg-indent">{c}</div>)}
      {open && (
        <div id={id} class="sg-indent">
          {m.solutions.map(s => (
            <SolutionCard key={s.id} s={s} env={d.query.env} same={d.alignment?.solutionId === s.id ? d.alignment : null} actions={actions} onUpdate={onUpdate} />
          ))}
          <Attribution src={m.source} />
        </div>
      )}
    </div>
  );
}

function SolutionCard({ s, env, same, actions, onUpdate }: {
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
  const flagged = (k: FlagKind) => s.mine.flags.includes(k);

  return (
    <div class={`sg-sol${same ? ' sg-sol-same' : ''}`}>
      <div class="sg-row">
        <TrustChip t={s.trust} />
        {same && <span class="sg-tag">{same.verdict === 'matches' ? 'Same as this answer' : 'Similar to this answer'}</span>}
      </div>
      <p>{clip(s.body)}</p>
      <EvidenceBar o={s.outcomes} />
      <SetupNotes s={s} />
      <div class="sg-row">
        <span>Tried it?</span>
        <OutcomeButtons mine={s.mine.outcome} busy={busy} onReport={report} />
        <button class="sg-link" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>Add context</button>
      </div>
      {noteOpen && (
        <textarea class="sg-text" maxLength={2000} value={note} aria-label="Context for your report"
          onInput={e => setNote((e.target as HTMLTextAreaElement).value)}
          placeholder="What happened? Versions, device, error message… Sent with your next Worked / Partly / Didn't work." />
      )}
      <div class="sg-row sg-small sg-muted">
        <span>Helpful?</span>
        <button class="sg-btn sg-btn-sm" aria-pressed={s.mine.helpful === true} disabled={busy} onClick={() => act(() => actions.vote({ solutionId: s.id, helpful: true }))}>
          Yes {s.votes.helpful}
        </button>
        <button class="sg-btn sg-btn-sm" aria-pressed={s.mine.helpful === false} disabled={busy} onClick={() => act(() => actions.vote({ solutionId: s.id, helpful: false }))}>
          No {s.votes.notHelpful}
        </button>
        <span class="sg-sep" />
        <button class="sg-btn sg-btn-sm" aria-pressed={flagged('outdated')} disabled={busy || flagged('outdated')} onClick={() => flag('outdated')}>
          Outdated{s.flags.outdated ? ` ${s.flags.outdated}` : ''}
        </button>
        <button class="sg-btn sg-btn-sm" aria-pressed={flagged('misleading')} disabled={busy || flagged('misleading')} onClick={() => flag('misleading')}>
          Misleading{s.flags.misleading ? ` ${s.flags.misleading}` : ''}
        </button>
      </div>
      {err && <div class="sg-warn-line" role="alert">{err}</div>}
    </div>
  );
}

function Attribution({ src }: { src: Source }) {
  const who = [src.author, src.license].filter(Boolean).join(' · ');
  return (
    <div class="sg-src">
      Source: {src.url ? <a href={src.url} target="_blank" rel="noopener noreferrer">{src.name}</a> : src.name}
      {who && ` · ${who}`}
    </div>
  );
}

/** Developer-facing details: what was searched and how each match ranked. */
export function WhyDetails({ d }: { d: VerifyResponse }) {
  return (
    <details class="sg-why">
      <summary>Why these results?</summary>
      <div>Error signatures: {d.query.errorSigs.length ? d.query.errorSigs.join(', ') : 'none'}</div>
      <div>Your environment: {Object.keys(d.query.env).length ? JSON.stringify(d.query.env) : 'none detected'}</div>
      {d.alignment?.similarity != null && <div>Answer similarity to the matched fix: {pct(d.alignment.similarity)}</div>}
      <ul>
        {d.matches.map(m => (
          <li key={m.problemId}>
            {m.title}: similarity {pct(m.similarity)}, env fit {pct(m.fit.score)}, ranks vector {rank(m.ranks.vector)} / text{' '}
            {rank(m.ranks.text)} / error {rank(m.ranks.errorSig)}
          </li>
        ))}
      </ul>
      <div>Sent only when you clicked Check: this question and answer. Reports are anonymous.</div>
    </details>
  );
}
