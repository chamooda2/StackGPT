import { beforeEach, describe, expect, it } from 'vitest';
import { chatgpt, SEL } from '../src/lib/chatgpt';
import html from './fixtures/chatgpt-legacy.html?raw';

beforeEach(() => {
  document.body.innerHTML = html;
});

const answer = (id: string) => chatgpt.answers(document).find(a => a.id === id)!;

describe('ChatGptAdapter on the legacy layout (fallback)', () => {
  it('finds real answers in order and skips the slug-less Thinking pseudo-message', () => {
    expect(chatgpt.answers(document).map(a => a.id)).toEqual(['a1', 'a2']);
  });

  it('pairs each answer with the preceding user message', () => {
    expect(chatgpt.question(answer('a1'), document)).toBe('pip install fails on Ubuntu 24.04 with\nerror: externally-managed-environment');
    expect(chatgpt.question(answer('a2'), document)).toBe('How do I read a UTF-8 file on Windows without UnicodeDecodeError?');
  });

  it('extracts prose without code blocks or code-block chrome', () => {
    const { prose } = chatgpt.extract(answer('a1'));
    expect(prose).toBe(
      [
        'This error comes from PEP 668: Ubuntu marks the system Python as managed by apt.',
        'Install the venv module:',
        'Create and activate a virtual environment.',
        'Install your package with pip install requests.',
        'Avoid --break-system-packages unless you know what you are doing.',
      ].join('\n'),
    );
    expect(prose).not.toContain('Copy code');
    expect(prose).not.toContain('python3 -m venv');
  });

  it('extracts code blocks with language from language-* and shell detection', () => {
    expect(chatgpt.extract(answer('a1')).codeBlocks).toEqual([
      { lang: 'bash', code: 'sudo apt install python3-venv', isShell: true },
      { lang: 'bash', code: 'python3 -m venv .venv\nsource .venv/bin/activate', isShell: true },
    ]);
    expect(chatgpt.extract(answer('a2')).codeBlocks).toEqual([
      { lang: 'python', code: 'with open("data.txt", encoding="utf-8") as f:\n    text = f.read()', isShell: false },
    ]);
  });

  it('takes steps from ordered lists only', () => {
    expect(chatgpt.extract(answer('a1')).steps).toEqual([
      'Install the venv module: sudo apt install python3-venv',
      'Create and activate a virtual environment.',
      'Install your package with pip install requests.',
    ]);
    expect(chatgpt.extract(answer('a2')).steps).toEqual([]);
  });

  it('reports generating while the stop button or streaming class is present', () => {
    const a = answer('a2');
    expect(chatgpt.generating(a, document)).toBe(false);

    const stop = document.createElement('button');
    stop.setAttribute('data-testid', 'stop-button');
    document.body.append(stop);
    expect(chatgpt.generating(a, document)).toBe(true);
    stop.remove();

    a.content.classList.add(SEL.legacy.streaming.slice(1));
    expect(chatgpt.generating(a, document)).toBe(true);
  });

  it('anchors the badge on the answer element', () => {
    expect(chatgpt.anchor(answer('a1'))).toBe(answer('a1').el);
  });

  it("follows ChatGPT's own theme class over the OS setting", () => {
    const c = document.documentElement.classList;
    c.add('dark');
    expect(chatgpt.theme(document)).toBe('dark');
    c.replace('dark', 'light');
    expect(chatgpt.theme(document)).toBe('light');
    c.remove('light');
  });
});
