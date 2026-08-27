// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMoreComments } from '../src/loader';

describe('loadMoreComments', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('stays inside the selected post and never repeats a stagnant button', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const target = document.createElement('article');
    const targetButton = document.createElement('button');
    targetButton.textContent = '查看更多留言';
    targetButton.getBoundingClientRect = () => ({ width: 100, height: 40 } as DOMRect);
    const unrelated = document.createElement('button');
    unrelated.textContent = '查看更多留言';
    unrelated.getBoundingClientRect = () => ({ width: 100, height: 40 } as DOMRect);
    const targetClick = vi.fn();
    const unrelatedClick = vi.fn();
    targetButton.addEventListener('click', targetClick);
    unrelated.addEventListener('click', unrelatedClick);
    target.append(targetButton);
    document.body.append(target, unrelated);

    const operation = loadMoreComments(target, () => 0, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    await operation;

    expect(targetClick).toHaveBeenCalledTimes(1);
    expect(unrelatedClick).not.toHaveBeenCalled();
  });

  it('uses iPhone aria labels and can click the same control again after progress', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const target = document.createElement('article');
    const button = document.createElement('div');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', '還有更多內容，按兩下即可查看留言');
    button.getBoundingClientRect = () => ({ width: 100, height: 40 } as DOMRect);
    let count = 17;
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
      if (clicks <= 2) count += 10;
      else button.remove();
    });
    target.append(button);
    document.body.append(target);
    const operation = loadMoreComments(target, () => count, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    await operation;
    expect(clicks).toBe(3);
    expect(count).toBe(37);
  });
});
