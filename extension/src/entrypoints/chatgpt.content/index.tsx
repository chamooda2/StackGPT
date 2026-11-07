import { render } from 'preact';
import { browser } from 'wxt/browser';
import { createShadowRootUi, type ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { Actions, Msg, Reply, SolutionSummary, VerifyRequest, VerifyResponse } from '../../lib/api';
import { chatgpt as site } from '../../lib/chatgpt';
import { clientOs } from '../../lib/text';
import { watch } from '../../lib/watch';
import { Check } from '../../ui/Check';
import './style.css';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  cssInjectionMode: 'ui',

  main(ctx) {
    const uis = new Map<string, ShadowRootContentScriptUi<HTMLElement>>();
    const mounting = new Set<string>();

    const send = async <T,>(msg: Msg): Promise<T> => {
      const r = (await browser.runtime.sendMessage(msg)) as Reply<T> | undefined;
      if (!r) throw new Error('extension background did not respond');
      if (!r.ok) throw new Error(r.error);
      return r.data;
    };

    const actions = (id: string): Actions => ({
      // Re-reads the answer at click time: the element may have been re-rendered since it was badged.
      async verify() {
        const a = site.answers(document).find(x => x.id === id);
        if (!a) throw new Error('answer no longer on the page');
        const os = clientOs(navigator.userAgent);
        const req: VerifyRequest = {
          platform: site.platform,
          question: site.question(a, document) ?? '',
          answer: site.extract(a),
          envHints: os ? { clientOs: os } : undefined,
        };
        if (!req.question) throw new Error('could not find the question for this answer');
        return { req, resp: await send<VerifyResponse>({ type: 'verify', req }) };
      },
      attempt: req => send<SolutionSummary>({ type: 'attempt', req }),
      vote: req => send<SolutionSummary>({ type: 'vote', req }),
      flag: req => send<SolutionSummary>({ type: 'flag', req }),
      submit: req => send<SolutionSummary>({ type: 'submit', req }),
    });

    const stop = watch(document, site, async a => {
      const cur = uis.get(a.id);
      if (cur?.shadowHost.isConnected) {
        cur.shadowHost.dataset.theme = site.theme(document);
        return;
      }
      if (mounting.has(a.id)) return;
      mounting.add(a.id);
      try {
        cur?.remove();
        const ui = await createShadowRootUi(ctx, {
          name: 'stackgpt-check',
          position: 'inline',
          anchor: site.anchor(a),
          append: 'after',
          onMount: (c, _shadow, host) => {
            host.dataset.theme = site.theme(document);
            render(<Check actions={actions(a.id)} />, c);
            return c;
          },
          onRemove: c => c && render(null, c),
        });
        ui.mount();
        uis.set(a.id, ui);
      } finally {
        mounting.delete(a.id);
      }
    });

    ctx.onInvalidated(() => {
      stop();
      uis.forEach(ui => ui.remove());
    });
  },
});
