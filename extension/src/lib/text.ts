// Site-independent helpers for turning rendered markdown into plain text.

const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,tr,pre,div,ul,ol,table';
const CELLS = 'td,th';
const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'console', 'terminal', 'powershell', 'ps1', 'pwsh', 'cmd', 'bat', 'batch']);

/** Text of `el` without `drop` elements, one line per block, whitespace collapsed. O(nodes). */
export function textOf(el: Element, drop?: string): string {
  const c = el.cloneNode(true) as Element;
  if (drop) c.querySelectorAll(drop).forEach(n => n.remove());
  c.querySelectorAll(BLOCKS).forEach(n => n.append('\n'));
  c.querySelectorAll(CELLS).forEach(n => n.append(' '));
  return (c.textContent ?? '')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function isShell(lang: string | null, code: string): boolean {
  return (lang != null && SHELL.has(lang.toLowerCase())) || /^\s*[$>] \S/m.test(code);
}

/** Best-effort OS of the browser, sent as a weak hint (the question's own env wins). */
export function clientOs(ua: string): string | undefined {
  if (/Android/.test(ua)) return 'android';
  if (/iPhone|iPad/.test(ua)) return 'ios';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X/.test(ua)) return 'macos';
  if (/Linux/.test(ua)) return 'linux';
  return undefined;
}
