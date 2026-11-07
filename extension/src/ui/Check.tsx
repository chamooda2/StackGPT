import { useState } from 'preact/hooks';
import type { Actions, SolutionSummary, VerifyRequest, VerifyResponse } from '../lib/api';
import { aligned, errText, headline, patch, tone } from './logic';
import { Chevron, MatchItem, ReportAnswer, Verdict, WhyDetails } from './parts';

type State =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'ok'; data: VerifyResponse; req: VerifyRequest }
  | { k: 'error'; msg: string };

const SHOW = 5;

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
        <button class="sg-badge" onClick={run} disabled={s.k === 'loading'} aria-busy={s.k === 'loading'}
          title="Sends this question and answer to StackGPT to look for community evidence">
          <span class="sg-brand">StackGPT</span>
          <span>{s.k === 'loading' ? 'Checking…' : 'Check this answer'}</span>
        </button>
      </div>
    );

  if (s.k === 'error')
    return (
      <div class="sg">
        <div class="sg-badge sg-badge-err" role="alert">
          <span class="sg-brand">StackGPT</span>
          <span>{s.msg}</span>
          <button class="sg-link" onClick={run}>Retry</button>
        </div>
      </div>
    );

  const d = s.data;
  const update = (x: SolutionSummary) => setS(cur => (cur.k === 'ok' ? { ...cur, data: patch(cur.data, x) } : cur));
  const hasVerdict = !!aligned(d);
  return (
    <div class="sg">
      <button class="sg-badge" aria-expanded={open} aria-controls="sg-panel" onClick={() => setOpen(!open)}>
        <span class="sg-brand">StackGPT</span>
        <span class={`sg-dot sg-tone-${tone(d)}`} aria-hidden="true" />
        <span>{headline(d)}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div class="sg-panel" id="sg-panel" aria-live="polite">
          <Verdict d={d} />
          {d.alignment && <ReportAnswer d={d} req={s.req} actions={actions} onUpdate={update} />}
          {d.matches.length > 0 && (
            <section class="sg-section">
              <h4 class="sg-h">Similar problems ({d.matches.length})</h4>
              {d.matches.slice(0, SHOW).map((m, i) => (
                <MatchItem key={m.problemId} m={m} d={d} actions={actions} onUpdate={update} initiallyOpen={i === 0 && !hasVerdict} />
              ))}
            </section>
          )}
          <WhyDetails d={d} />
        </div>
      )}
    </div>
  );
}
