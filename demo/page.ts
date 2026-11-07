// Builds a stand-in chatgpt.com conversation in ChatGPT's current DOM layout (see
// extension/tests/fixtures/chatgpt-current.html), so the real extension can run on it without a login.

export type Block = { p: string } | { h: string } | { code: string; lang: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function block(b: Block): string {
  if ('p' in b) return `<p data-d-component="text"><span data-d-stream-run="">${esc(b.p)}</span></p>`;
  if ('h' in b) return `<h3 data-d-component="title"><span data-d-stream-run="">${esc(b.h)}</span></h3>`;
  const lines = b.code.split('\n').map(l => `<span>${esc(l)}</span>`).join('<span>\n</span>');
  return `<div data-client-defined-widget="code_block"><div class="CodeBlock" data-chatgpt-copy-code="${esc(b.code)}">
      <div data-code-block="true" data-theme="dark">
        <div class="code-head" data-markdown-copy="exclude"><div>${esc(b.lang)}</div><button aria-label="Copy code">Copy</button></div>
        <pre><code>${lines}</code></pre>
      </div></div></div>`;
}

export function conversation(id: string, question: string, answer: Block[]): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ChatGPT (demo)</title>
<style>
  body { margin: 0; background: #212121; color: #ececec; font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
  .note { font-size: 12px; color: #9b9b9b; text-align: center; margin-bottom: 24px; }
  [data-user-message-bubble] { margin-left: auto; width: fit-content; max-width: 80%; background: #303030; border-radius: 18px; padding: 10px 16px; margin-bottom: 24px; white-space: pre-wrap; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  h3 { font-size: 17px; margin: 18px 0 6px; }
  [data-client-defined-widget] { margin: 8px 0 12px; border-radius: 12px; overflow: hidden; background: #0d0d0d; }
  .code-head { display: flex; justify-content: space-between; padding: 6px 14px; font-size: 12px; color: #b4b4b4; background: #2f2f2f; }
  .code-head button { background: none; border: 0; color: inherit; font: inherit; }
  pre { margin: 0; padding: 12px 14px; font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap; }
  .actions { margin-top: 4px; font-size: 12px; color: #9b9b9b; }
</style></head><body>
<div class="contents" data-app-shell-active-page="true"><main>
  <div class="note">Demo page in ChatGPT's layout · StackGPT runs on it exactly as on chatgpt.com</div>
  <div data-turn-key="${id}-t0"><div class="group flex flex-col" data-talvt-turn-state="complete"><div class="flex flex-col gap-3">
    <div class="block">
      <h4 class="sr-only" data-conversation-role="user">You said:</h4>
      <div data-content-search-unit-key="${id}:0:user"><div data-user-message-bubble="true"><div class="whitespace-pre-wrap">${esc(question)}</div></div></div>
    </div>
    <div class="block">
      <div data-content-search-unit-key="${id}:2:assistant">
        <h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4>
        <div data-chatgpt-selection-message-id="${id}-a">
          <div data-markdown-text-style="assistant-message"><div data-markdown-copy="contents">
            <div class="Renderer" data-theme="dark"><div data-dil-response="">${answer.map(block).join('\n')}</div></div>
          </div></div>
        </div>
      </div>
    </div>
  </div><div class="actions">Copy · Rate · Share</div></div></div>
</main></div>
</body></html>`;
}
