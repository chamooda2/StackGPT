import type { ExtractedAnswer } from './api';

/** A real (non-placeholder) assistant answer on the page. */
export interface Answer {
  id: string;
  el: HTMLElement;
  content: HTMLElement;
}

/** Site-specific DOM knowledge. One implementation per chat site; all selectors live in it. */
export interface SiteAdapter {
  readonly platform: string;
  /** Real assistant answers in document order. */
  answers(root: ParentNode): Answer[];
  /** Text of the user message preceding the answer (the problem description), or null. */
  question(a: Answer, root: ParentNode): string | null;
  /** True while the site is still generating this answer. */
  generating(a: Answer, root: ParentNode): boolean;
  extract(a: Answer): ExtractedAnswer;
  /** The badge is inserted right after this element. */
  anchor(a: Answer): Element;
  /** The site's current colour theme (it may differ from the OS setting). */
  theme(doc: Document): 'light' | 'dark';
}
