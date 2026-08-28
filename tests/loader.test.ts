// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasPendingExpansionControls, loadMoreComments } from '../src/loader';

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
    targetButton.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
    const unrelated = document.createElement('button');
    unrelated.textContent = '查看更多留言';
    unrelated.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
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

  it('repeats only a visible button with explicit safe text after progress', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const target = document.createElement('article');
    const button = document.createElement('div');
    button.setAttribute('role', 'button');
    button.textContent = '查看更多留言';
    button.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
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
  it('never clicks an aria-only 查看留言 control that may open the reactions list', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const root = document.createElement('div');
    const unsafe = document.createElement('div');
    unsafe.setAttribute('role', 'button');
    unsafe.setAttribute('aria-label', '59 人，按兩下即可查看留言');
    unsafe.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
    const clicked = vi.fn();
    unsafe.addEventListener('click', clicked);
    root.append(unsafe);
    document.body.append(root);
    const operation = loadMoreComments(root, () => 7, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    await operation;
    expect(clicked).not.toHaveBeenCalled();
  });

  it('safely expands an explicit visible reply control', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const root = document.createElement('div');
    const replyButton = document.createElement('div');
    replyButton.setAttribute('role', 'button');
    replyButton.textContent = '查看 9 則回覆';
    replyButton.getBoundingClientRect = () => ({ width: 100, height: 40, top: 10, bottom: 50 } as DOMRect);
    const clicked = vi.fn();
    replyButton.addEventListener('click', clicked);
    root.append(replyButton);
    document.body.append(root);
    const operation = loadMoreComments(root, () => 1, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    await operation;
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('expands iPhone aria-only numbered reply controls', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const root = document.createElement('div');
    const replyButton = document.createElement('div');
    replyButton.setAttribute('role', 'button');
    replyButton.setAttribute('aria-label', '查看更多 8 則回覆，按兩下即可展開');
    replyButton.getBoundingClientRect = () => ({ width: 100, height: 40, top: 10, bottom: 50 } as DOMRect);
    const clicked = vi.fn(() => replyButton.remove());
    replyButton.addEventListener('click', clicked);
    root.append(replyButton);
    document.body.append(root);
    const operation = loadMoreComments(root, () => 1, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    await operation;
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('does not report complete while a tried expansion control remains rendered', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const root = document.createElement('div');
    const replyButton = document.createElement('button');
    replyButton.textContent = '查看1則回覆';
    replyButton.getBoundingClientRect = () => ({ width: 100, height: 40, top: 10, bottom: 50 } as DOMRect);
    root.append(replyButton);
    document.body.append(root);

    const operation = loadMoreComments(root, () => 1, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();

    await expect(operation).resolves.toMatchObject({
      reason: 'controls-remain',
      pendingControls: true,
      stablePasses: 0,
    });
    expect(hasPendingExpansionControls(root)).toBe(true);
  });

  it('ignores disabled and already-expanded controls when verifying pending work', () => {
    const root = document.createElement('div');
    const disabled = document.createElement('button');
    disabled.textContent = '查看更多留言';
    disabled.disabled = true;
    const ariaDisabled = document.createElement('div');
    ariaDisabled.setAttribute('role', 'button');
    ariaDisabled.setAttribute('aria-disabled', 'true');
    ariaDisabled.textContent = '查看2則回覆';
    const expanded = document.createElement('button');
    expanded.setAttribute('aria-expanded', 'true');
    expanded.textContent = '查看1則回覆';
    for (const control of [disabled, ariaDisabled, expanded]) {
      control.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
      root.append(control);
    }
    document.body.append(root);
    expect(hasPendingExpansionControls(root)).toBe(false);
  });

  it('expands exact 查看更多 only inside a comment row', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const root = document.createElement('div');
    const comment = document.createElement('article');
    comment.setAttribute('aria-label', '甲的留言');
    const commentMore = document.createElement('button');
    commentMore.textContent = '查看更多';
    const postMore = document.createElement('button');
    postMore.textContent = '查看更多';
    [commentMore, postMore].forEach((button) => { button.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect); });
    const commentClick = vi.fn();
    const postClick = vi.fn();
    commentMore.addEventListener('click', commentClick);
    postMore.addEventListener('click', postClick);
    comment.append(commentMore);
    root.append(comment, postMore);
    document.body.append(root);
    const operation = loadMoreComments(root, () => 1, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    await operation;
    expect(commentClick).toHaveBeenCalledTimes(1);
    expect(postClick).not.toHaveBeenCalled();
  });

  it('does not treat post text 查看更多 as a comment merely because an ancestor mentions a comment count', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const root = document.createElement('div');
    root.setAttribute('aria-label', '貼文，167 則留言');
    const more = document.createElement('button');
    more.textContent = '查看更多';
    more.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
    const clicked = vi.fn();
    more.addEventListener('click', clicked);
    root.append(more);
    document.body.append(root);
    const operation = loadMoreComments(root, () => 1, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    await operation;
    expect(clicked).not.toHaveBeenCalled();
  });

  it('does not stop merely because the parsed count stays unchanged for three rounds', async () => {
    vi.useFakeTimers();
    let y = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
    vi.spyOn(window, 'scrollBy').mockImplementation(() => { y += 500; });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 10_000 });
    const progress: number[] = [];
    const operation = loadMoreComments(
      document,
      () => 7,
      ({ round }) => { progress.push(round); },
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await operation;
    expect(Math.max(...progress)).toBeGreaterThan(3);
  });

  it('requires a stable boundary and signature, not only a stable count', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
    let reads = 0;
    const operation = loadMoreComments(
      document,
      () => ({ commentCount: 7, boundary: `last-${Math.min(++reads, 2)}`, signature: `set-${Math.min(reads, 2)}` }),
      () => undefined,
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await expect(operation).resolves.toMatchObject({
      reason: 'complete',
      finalCount: 7,
      boundary: 'last-2',
      signature: 'set-2',
      stablePasses: 2,
    });
  });

  it('runs an extra full verification pass while Facebook reports a count gap', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
    const operation = loadMoreComments(
      document,
      () => ({ commentCount: 7, expectedCount: 10, boundary: 'last', signature: 'set' }),
      () => undefined,
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await expect(operation).resolves.toMatchObject({ reason: 'complete', stablePasses: 3, finalCount: 7 });
  });

  it('finishes three verification passes on a tall mobile comment page', async () => {
    vi.useFakeTimers();
    let y = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
    vi.spyOn(window, 'scrollBy').mockImplementation((optionsOrX?: ScrollToOptions | number) => {
      y += typeof optionsOrX === 'object' ? Number(optionsOrX.top ?? 0) : Number(optionsOrX ?? 0);
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 742 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 45_256 });
    const root = document.createElement('section');
    root.scrollIntoView = vi.fn(() => { y = 0; });
    document.body.append(root);
    const progress: number[] = [];
    const operation = loadMoreComments(
      root,
      () => ({ commentCount: 151, expectedCount: 167, boundary: 'last', signature: 'set' }),
      ({ round }) => { progress.push(round); },
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await expect(operation).resolves.toMatchObject({ reason: 'complete', stablePasses: 3, finalCount: 151 });
    expect(Math.max(...progress)).toBeGreaterThan(180);
  });

  it('uses the nearest scrollable ancestor after positioning the comment root', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const container = document.createElement('div');
    const root = document.createElement('article');
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 400 },
    });
    container.style.overflowY = 'auto';
    const scrollBy = vi.fn((optionsOrX?: ScrollToOptions | number) => {
      if (typeof optionsOrX === 'object') container.scrollTop += Number(optionsOrX.top ?? 0);
    });
    const scrollTo = vi.fn((optionsOrX?: ScrollToOptions | number) => {
      if (typeof optionsOrX === 'object') container.scrollTop = Number(optionsOrX.top ?? 0);
    });
    container.scrollBy = scrollBy as unknown as typeof container.scrollBy;
    container.scrollTo = scrollTo as unknown as typeof container.scrollTo;
    root.scrollIntoView = vi.fn();
    container.append(root);
    document.body.append(container);
    const observedPositions: number[] = [];
    const operation = loadMoreComments(root, () => {
      observedPositions.push(container.scrollTop);
      return 1;
    }, () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    await expect(operation).resolves.toMatchObject({ reason: 'complete', scrollRoot: 'container' });
    expect(root.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(scrollBy).toHaveBeenCalled();
    expect(observedPositions.filter((position) => position === 0)).toHaveLength(2);
    expect(observedPositions.some((position) => position > 0 && position < 400)).toBe(true);
    expect(observedPositions.some((position) => position >= 300)).toBe(true);
  });
});
