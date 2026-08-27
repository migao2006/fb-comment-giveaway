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
});
