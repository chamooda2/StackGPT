import type { Answer, SiteAdapter } from './adapter';
import type { CodeBlock, ExtractedAnswer } from './api';
import { isShell, textOf } from './text';

// Every chatgpt.com DOM assumption lives here. When ChatGPT changes its markup, only this file changes.
export const SEL = {
  msg: '[data-message-author-role]',
  roleAttr: 'data-message-author-role',
  idAttr: 'data-message-id',
  // Real answers carry a model slug; the transient "Thinking" pseudo-message does not.
  answer: '[data-message-author-role="assistant"][data-message-model-slug]',
  content: '.markdown',
  streaming: '.result-streaming',
  stop: '[data-testid="stop-button"]',
  codeBlock: 'pre',
  code: 'code',
  langPrefix: 'language-',
  steps: 'ol > li',
  // ChatGPT's own theme setting, as a class on <html>; absent means "follow the system".
  darkClass: 'dark',
  lightClass: 'light',
} as const;

export const chatgpt: SiteAdapter = {
  platform: 'chatgpt',

  answers(root) {
    const out: Answer[] = [];
    root.querySelectorAll<HTMLElement>(SEL.answer).forEach(el => {
      const id = el.getAttribute(SEL.idAttr);
      const content = el.querySelector<HTMLElement>(SEL.content);
      if (id && content) out.push({ id, el, content });
    });
    return out;
  },

  // Walks back from the answer to the nearest user message. O(m) for m messages.
  question(a, root) {
    const all = [...root.querySelectorAll<HTMLElement>(SEL.msg)];
    for (let i = all.indexOf(a.el) - 1; i >= 0; i--) {
      const m = all[i]!;
      if (m.getAttribute(SEL.roleAttr) === 'user') return textOf(m) || null;
    }
    return null;
  },

  generating(a, root) {
    return root.querySelector(SEL.stop) != null || a.content.matches(SEL.streaming) || a.el.querySelector(SEL.streaming) != null;
  },

  extract(a) {
    const c = a.content;
    const codeBlocks: CodeBlock[] = [];
    c.querySelectorAll(SEL.codeBlock).forEach(pre => {
      const code = pre.querySelector(SEL.code);
      const text = (code ?? pre).textContent?.replace(/\n+$/, '') ?? '';
      if (!text.trim()) return;
      const lang = [...(code?.classList ?? [])].find(k => k.startsWith(SEL.langPrefix))?.slice(SEL.langPrefix.length) ?? null;
      codeBlocks.push({ lang, code: text, isShell: isShell(lang, text) });
    });
    // Top-level ordered lists only; nested sub-steps stay inside their parent step's text.
    const steps = [...c.querySelectorAll(SEL.steps)]
      .filter(li => !li.parentElement?.closest('li'))
      .map(stepText)
      .filter(Boolean);
    return { prose: textOf(c, SEL.codeBlock), codeBlocks, steps } satisfies ExtractedAnswer;
  },

  anchor: a => a.el,

  theme(doc) {
    const c = doc.documentElement.classList;
    if (c.contains(SEL.darkClass)) return 'dark';
    if (c.contains(SEL.lightClass)) return 'light';
    return doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },
};

// A code block inside a step contributes its code only, not the language label / copy-button chrome.
function stepText(li: Element): string {
  const c = li.cloneNode(true) as Element;
  c.querySelectorAll(SEL.codeBlock).forEach(pre => pre.replaceWith(` ${(pre.querySelector(SEL.code) ?? pre).textContent ?? ''} `));
  return textOf(c).replace(/\n/g, ' ');
}
