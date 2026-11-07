import type { Answer, SiteAdapter } from './adapter';
import type { CodeBlock, ExtractedAnswer } from './api';
import { isShell, textOf } from './text';

// Every chatgpt.com DOM assumption lives here. When ChatGPT changes its markup, only this file changes.
// Two layouts are supported: the current one (observed 2026-11) and the legacy one, used as a fallback
// while ChatGPT rolls redesigns out gradually.
export const SEL = {
  // Inactive conversations stay mounted in the DOM; only the active page is the open chat.
  page: '[data-app-shell-active-page="true"]',
  unit: '[data-content-search-unit-key]', // value "<turn>:<index>:<role>"
  unitKeyAttr: 'data-content-search-unit-key',
  answerUnit: '[data-content-search-unit-key$=":assistant"]',
  msgId: '[data-chatgpt-selection-message-id]',
  msgIdAttr: 'data-chatgpt-selection-message-id',
  content: '[data-markdown-text-style="assistant-message"]',
  userText: '[data-user-message-bubble]',
  turnState: '[data-talvt-turn-state]',
  turnStateAttr: 'data-talvt-turn-state',
  turnDone: 'complete',
  codeWidget: '[data-client-defined-widget="code_block"]',
  codeCopyAttr: 'data-chatgpt-copy-code',
  // Code-block header (language label, copy/wrap buttons); excluded from copied text by ChatGPT itself.
  chrome: '[data-markdown-copy="exclude"]',
  title: '[data-d-component="title"]',
  theme: '[data-theme]',

  legacy: {
    msg: '[data-message-author-role]',
    roleAttr: 'data-message-author-role',
    idAttr: 'data-message-id',
    // Real answers carry a model slug; the transient "Thinking" pseudo-message does not.
    answer: '[data-message-author-role="assistant"][data-message-model-slug]',
    content: '.markdown',
    streaming: '.result-streaming',
  },

  stop: 'button[aria-label="Stop"], [data-testid="stop-button"]',
  pre: 'pre',
  code: 'code',
  langPrefix: 'language-',
  steps: 'ol > li',
  darkClass: 'dark',
  lightClass: 'light',
} as const;

const NUMBERED = /^\s*\d+[.)]\s+(.+)$/;

const scope = (root: ParentNode): ParentNode => root.querySelector(SEL.page) ?? root;
const isCurrent = (a: Answer) => a.el.matches(SEL.answerUnit);

export const chatgpt: SiteAdapter = {
  platform: 'chatgpt',

  answers(root) {
    const s = scope(root);
    const out: Answer[] = [];
    s.querySelectorAll<HTMLElement>(SEL.answerUnit).forEach(el => {
      const id = el.querySelector(SEL.msgId)?.getAttribute(SEL.msgIdAttr);
      const content = el.querySelector<HTMLElement>(SEL.content);
      if (id && content) out.push({ id, el, content });
    });
    if (out.length) return out;
    s.querySelectorAll<HTMLElement>(SEL.legacy.answer).forEach(el => {
      const id = el.getAttribute(SEL.legacy.idAttr);
      const content = el.querySelector<HTMLElement>(SEL.legacy.content);
      if (id && content) out.push({ id, el, content });
    });
    return out;
  },

  // Walks back from the answer to the nearest user message. O(m) for m messages.
  question(a, root) {
    const cur = isCurrent(a);
    const all = [...scope(root).querySelectorAll<HTMLElement>(cur ? SEL.unit : SEL.legacy.msg)];
    for (let i = all.indexOf(a.el) - 1; i >= 0; i--) {
      const m = all[i]!;
      const user = cur ? m.getAttribute(SEL.unitKeyAttr)?.endsWith(':user') : m.getAttribute(SEL.legacy.roleAttr) === 'user';
      if (user) return textOf((cur && m.querySelector(SEL.userText)) || m) || null;
    }
    return null;
  },

  generating(a, root) {
    const state = a.el.closest(SEL.turnState)?.getAttribute(SEL.turnStateAttr);
    if (state != null) return state !== SEL.turnDone;
    return root.querySelector(SEL.stop) != null || a.content.matches(SEL.legacy.streaming) || a.el.querySelector(SEL.legacy.streaming) != null;
  },

  extract(a) {
    const c = a.content;
    const codeBlocks: CodeBlock[] = [];
    c.querySelectorAll(`${SEL.codeWidget}, ${SEL.pre}`).forEach(b => {
      if (b.matches(SEL.pre) && b.closest(SEL.codeWidget)) return;
      const cb = codeOf(b);
      if (cb.code.trim()) codeBlocks.push(cb);
    });
    // Steps: top-level ordered-list items, or numbered headings ("1. Install ...") in the current layout.
    const steps: string[] = [];
    c.querySelectorAll(`${SEL.steps}, ${SEL.title}`).forEach(e => {
      if (e.matches(SEL.title)) {
        const m = NUMBERED.exec(textOf(e));
        if (m) steps.push(m[1]!);
      } else if (!e.parentElement?.closest('li')) {
        const t = stepText(e);
        if (t) steps.push(t);
      }
    });
    return { prose: textOf(c, `${SEL.codeWidget}, ${SEL.pre}, ${SEL.chrome}`), codeBlocks, steps } satisfies ExtractedAnswer;
  },

  anchor: a => a.el,

  theme(doc) {
    const c = doc.documentElement.classList;
    if (c.contains(SEL.darkClass)) return 'dark';
    if (c.contains(SEL.lightClass)) return 'light';
    const t = scope(doc).querySelector(SEL.theme)?.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },
};

function codeOf(b: Element): CodeBlock {
  if (b.matches(SEL.codeWidget)) {
    const code = b.querySelector(`[${SEL.codeCopyAttr}]`)?.getAttribute(SEL.codeCopyAttr) ?? b.querySelector(SEL.pre)?.textContent ?? '';
    const lang = b.querySelector(SEL.chrome)?.textContent?.trim().toLowerCase() || null;
    return { lang, code: code.replace(/\n+$/, ''), isShell: isShell(lang, code) };
  }
  const el = b.querySelector(SEL.code);
  const code = (el ?? b).textContent?.replace(/\n+$/, '') ?? '';
  const lang = [...(el?.classList ?? [])].find(k => k.startsWith(SEL.langPrefix))?.slice(SEL.langPrefix.length) ?? null;
  return { lang, code, isShell: isShell(lang, code) };
}

// A code block inside a step contributes its code only, not the language label / copy-button chrome.
function stepText(li: Element): string {
  const c = li.cloneNode(true) as Element;
  c.querySelectorAll(`${SEL.codeWidget}, ${SEL.pre}`).forEach(b => {
    if (c.contains(b)) b.replaceWith(` ${codeOf(b).code} `);
  });
  return textOf(c).replace(/\n/g, ' ');
}
