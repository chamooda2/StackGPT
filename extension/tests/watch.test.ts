import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatgpt } from '../src/lib/chatgpt';
import { Stability, watch } from '../src/lib/watch';

describe('Stability', () => {
  it('is done only after text is unchanged for 1.5s and generation stopped', () => {
    const s = new Stability(1500);
    expect(s.check('a', 'Hel', 0, true)).toBe(false); // first sight
    expect(s.check('a', 'Hello', 500, true)).toBe(false); // changed -> clock resets to 500
    expect(s.check('a', 'Hello', 1900, false)).toBe(false); // 1400ms stable
    expect(s.check('a', 'Hello', 2000, true)).toBe(false); // 1500ms stable but still generating
    expect(s.check('a', 'Hello', 2100, false)).toBe(true);
  });

  it('never finishes an empty answer', () => {
    const s = new Stability(1500);
    s.check('a', '  ', 0, false);
    expect(s.check('a', '  ', 5000, false)).toBe(false);
  });
});

describe('watch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div data-message-author-role="user" data-message-id="u1">Why?</div>
      <div data-message-author-role="assistant" data-message-id="a1" data-message-model-slug="m">
        <div class="markdown">Because.</div>
      </div>
      <button data-testid="stop-button"></button>`;
  });
  afterEach(() => vi.useRealTimers());

  it('waits for the stop button to disappear, then reports the answer', async () => {
    const ready = vi.fn();
    const stop = watch(document, chatgpt, ready);

    await vi.advanceTimersByTimeAsync(3000);
    expect(ready).not.toHaveBeenCalled();

    document.querySelector('[data-testid="stop-button"]')!.remove();
    await vi.advanceTimersByTimeAsync(2000);
    expect(ready).toHaveBeenCalled();
    expect(ready.mock.calls[0]?.[0].id).toBe('a1');
    stop();
  });

  it('stops ticking once every answer is done', async () => {
    document.querySelector('[data-testid="stop-button"]')!.remove();
    const ready = vi.fn();
    const stop = watch(document, chatgpt, ready);
    await vi.advanceTimersByTimeAsync(2500);
    const n = ready.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ready.mock.calls.length).toBe(n);
    stop();
  });
});
