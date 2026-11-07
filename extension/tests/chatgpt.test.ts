import { beforeEach, describe, expect, it } from 'vitest';
import { chatgpt, SEL } from '../src/lib/chatgpt';
import html from './fixtures/chatgpt-current.html?raw';

beforeEach(() => {
  document.documentElement.className = '';
  document.body.innerHTML = html;
});

const answer = (id: string) => chatgpt.answers(document).find(a => a.id === id)!;

describe('ChatGptAdapter on the current layout', () => {
  it('finds answers in the active conversation only, skipping units without a message id', () => {
    expect(chatgpt.answers(document).map(a => a.id)).toEqual(['a1', 'a2']);
  });

  it('pairs each answer with the preceding user message', () => {
    expect(chatgpt.question(answer('a1'), document)).toBe('pip install fails on Ubuntu 24.04 with error: externally-managed-environment');
    expect(chatgpt.question(answer('a2'), document)).toBe('How do I read a UTF-8 file on Windows without UnicodeDecodeError?');
  });

  it('extracts prose without code widgets, their headers or the sr-only role labels', () => {
    expect(chatgpt.extract(answer('a1')).prose).toBe(
      [
        'The externally-managed-environment error occurs because Ubuntu protects its system Python.',
        'Step-by-step fix',
        '1. Install the venv module',
        'Open your terminal and run:',
        '2. Create and activate a virtual environment',
        '3. Install your packages',
        'Now pip install requests works inside the venv.',
      ].join('\n'),
    );
  });

  it('takes code from data-chatgpt-copy-code and the language from the widget header', () => {
    expect(chatgpt.extract(answer('a1')).codeBlocks).toEqual([
      { lang: 'bash', code: 'sudo apt update\nsudo apt install python3-venv -y', isShell: true },
      { lang: 'bash', code: 'python3 -m venv .venv\nsource .venv/bin/activate', isShell: true },
    ]);
    expect(chatgpt.extract(answer('a2')).codeBlocks).toEqual([
      { lang: 'python', code: 'with open("data.txt", encoding="utf-8") as f:\n    text = f.read()', isShell: false },
    ]);
  });

  it('takes steps from numbered headings', () => {
    expect(chatgpt.extract(answer('a1')).steps).toEqual([
      'Install the venv module',
      'Create and activate a virtual environment',
      'Install your packages',
    ]);
    expect(chatgpt.extract(answer('a2')).steps).toEqual([]);
  });

  it('uses the turn state to tell whether the answer is still being generated', () => {
    const a = answer('a2');
    expect(chatgpt.generating(a, document)).toBe(false);
    a.el.closest(SEL.turnState)!.setAttribute(SEL.turnStateAttr, 'in_progress');
    expect(chatgpt.generating(a, document)).toBe(true);
  });

  it('anchors the badge on the assistant unit', () => {
    expect(chatgpt.anchor(answer('a1')).getAttribute(SEL.unitKeyAttr)).toBe('fallback-turn-0:2:assistant');
  });

  it('reads the theme from the renderer, with an <html> theme class taking precedence', () => {
    expect(chatgpt.theme(document)).toBe('dark');
    document.documentElement.classList.add('light');
    expect(chatgpt.theme(document)).toBe('light');
  });
});
