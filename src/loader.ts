export interface LoadingProgress {
  round: number;
  clicked: number;
  commentCount: number;
  message: string;
}

export type LoadingEndReason = 'complete' | 'controls-remain' | 'limit-reached' | 'root-lost' | 'aborted';

/** A caller may provide stable boundary/signature values in addition to the count. */
export interface LoadingSnapshot {
  commentCount: number;
  boundary?: string;
  signature?: string;
}

export interface LoadingResult {
  reason: LoadingEndReason;
  rounds: number;
  stablePasses: number;
  finalCount: number;
  boundary?: string;
  signature?: string;
  pendingControls: boolean;
  scrollRoot: 'window' | 'container';
}

const MORE_COMMENT_PATTERNS = [
  /^查看更多留言(?:（\d+）)?$/,
  /^顯示更多留言$/,
  /^更多留言$/,
  /^查看更多留言$/,
  /^查看先前的留言$/,
  /^查看另?\s*\d+\s*則留言$/,
];

const MORE_REPLY_PATTERNS = [
  /^查看更多回覆$/,
  /^顯示更多回覆$/,
  /^查看先前的回覆$/,
  /^查看另?\s*\d+\s*則回覆$/,
  /^查看\s*\d+\s*則回覆$/,
];

const textOf = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return isRendered(element, style, rect)
    && rect.bottom >= 0 && rect.top <= window.innerHeight;
}

function isRendered(element: HTMLElement, style = getComputedStyle(element), rect = element.getBoundingClientRect()): boolean {
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function findExpansionButtons(root: ParentNode, visibleOnly = true): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>('button, [role="button"]');
  return [...candidates].filter((element) => {
    const text = textOf(element);
    const unavailable = element.hasAttribute('disabled')
      || element.getAttribute('aria-disabled') === 'true'
      || element.getAttribute('aria-expanded') === 'true';
    return (visibleOnly ? isVisible(element) : isRendered(element))
      && !unavailable
      && ([...MORE_COMMENT_PATTERNS, ...MORE_REPLY_PATTERNS].some((pattern) => pattern.test(text)) || isTruncatedCommentButton(element, text))
      && !/(?:按讚|心情|反應)/.test(text);
  });
}

export function hasPendingExpansionControls(root: ParentNode): boolean {
  return findExpansionButtons(root, false).length > 0;
}

function isTruncatedCommentButton(element: HTMLElement, text: string): boolean {
  if (text !== '查看更多') return false;
  let parent = element.parentElement;
  for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
    const label = (parent.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
    if (parent.matches('[data-comment-id]') || /(?:的留言|的回覆|comment by .+|reply by .+)$/iu.test(label)) return true;
    const hasCommentAction = [...parent.querySelectorAll<HTMLElement>('button[aria-label], [role="button"][aria-label]')]
      .some((button) => /^留言.+按.+按/u.test(button.getAttribute('aria-label') ?? ''));
    if (hasCommentAction && parent.querySelectorAll('button, [role="button"]').length <= 12) return true;
  }
  return false;
}

const pause = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

type ScrollTarget = Window | HTMLElement;

function findScrollTarget(root: ParentNode): ScrollTarget {
  let current = root instanceof HTMLElement ? root : root instanceof Element ? root.parentElement : null;
  while (current) {
    const style = getComputedStyle(current);
    const canScroll = /(auto|scroll|overlay)/.test(style.overflowY)
      && current.scrollHeight > current.clientHeight + 24;
    if (canScroll) return current;
    current = current.parentElement;
  }
  return window;
}

function scrollTargetBy(target: ScrollTarget, amount: number): void {
  if (target === window) window.scrollBy({ top: amount, behavior: 'smooth' });
  else target.scrollBy({ top: amount, behavior: 'smooth' });
}

function scrollStep(target: ScrollTarget): number {
  return target instanceof HTMLElement
    ? Math.max(target.clientHeight * 0.72, 64)
    : Math.max(window.innerHeight * 0.72, 460);
}

function positionAtStart(root: ParentNode, target: ScrollTarget): void {
  if (target instanceof HTMLElement) {
    target.scrollTo?.({ top: 0, behavior: 'auto' });
    if (root !== target && root instanceof HTMLElement) root.scrollIntoView?.({ block: 'start' });
    return;
  }
  if (root instanceof HTMLElement) root.scrollIntoView?.({ block: 'start' });
}

function targetAtBottom(target: ScrollTarget): boolean {
  if (target === window) return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 96;
  if (target instanceof HTMLElement) return target.scrollTop + target.clientHeight >= target.scrollHeight - 96;
  return false;
}

function normalizeSnapshot(value: number | LoadingSnapshot): LoadingSnapshot {
  return typeof value === 'number' ? { commentCount: value } : value;
}

function sameSnapshot(left: LoadingSnapshot, right: LoadingSnapshot): boolean {
  return left.commentCount === right.commentCount
    && (left.boundary === undefined || right.boundary === undefined || left.boundary === right.boundary)
    && (left.signature === undefined || right.signature === undefined || left.signature === right.signature);
}

function snapshotKey(snapshot: LoadingSnapshot): string {
  return `${snapshot.commentCount}\u0000${snapshot.boundary ?? ''}\u0000${snapshot.signature ?? ''}`;
}

/**
 * Conservatively loads comments by clicking only known Traditional Chinese
 * controls. It stops on user abort, repeated no-progress rounds, or a hard cap.
 */
export async function loadMoreComments(
  root: ParentNode,
  getSnapshot: () => number | LoadingSnapshot,
  onProgress: (progress: LoadingProgress) => void,
  signal: AbortSignal,
): Promise<LoadingResult> {
  const maxRounds = 120;
  const clickedAtSnapshot = new WeakMap<HTMLElement, string>();
  const scrollTarget = findScrollTarget(root);
  let rounds = 0;
  let stablePasses = 0;
  let previous: LoadingSnapshot;
  let completedPassSnapshot: LoadingSnapshot | undefined;

  const result = (reason: LoadingEndReason, pendingControls = hasPendingExpansionControls(root)): LoadingResult => ({
    reason,
    rounds: Math.min(rounds, maxRounds),
    stablePasses,
    finalCount: previous.commentCount,
    ...(previous.boundary === undefined ? {} : { boundary: previous.boundary }),
    ...(previous.signature === undefined ? {} : { signature: previous.signature }),
    pendingControls,
    scrollRoot: scrollTarget instanceof HTMLElement ? 'container' : 'window',
  });

  positionAtStart(root, scrollTarget);
  await pause(250, signal);
  previous = normalizeSnapshot(getSnapshot());

  for (rounds = 1; rounds <= maxRounds && !signal.aborted; rounds += 1) {
    if (root instanceof Element && !root.isConnected) return result('root-lost', false);
    const key = snapshotKey(previous);
    const buttons = findExpansionButtons(root)
      .filter((button) => clickedAtSnapshot.get(button) !== key)
      .slice(0, 4);
    buttons.forEach((button) => {
      clickedAtSnapshot.set(button, key);
      button.click();
    });
    scrollTargetBy(scrollTarget, scrollStep(scrollTarget));
    onProgress({
      round: rounds,
      clicked: buttons.length,
      commentCount: previous.commentCount,
      message: buttons.length ? '正在等待 Facebook 展開留言或回覆…' : '安全捲動中，正在尋找更多留言…',
    });
    await pause(buttons.length ? 1100 : 750, signal);
    if (signal.aborted) break;
    if (root instanceof Element && !root.isConnected) return result('root-lost', false);
    const current = normalizeSnapshot(getSnapshot());
    const settledAtBottom = targetAtBottom(scrollTarget) && sameSnapshot(previous, current);
    previous = current;
    onProgress({ round: rounds, clicked: buttons.length, commentCount: current.commentCount, message: `已辨識 ${current.commentCount} 則留言（含回覆）` });
    if (settledAtBottom) {
      const pending = findExpansionButtons(root, false);
      const freshControl = pending.find((button) => clickedAtSnapshot.get(button) !== snapshotKey(current));
      if (freshControl) {
        freshControl.scrollIntoView?.({ block: 'center' });
        stablePasses = 0;
        completedPassSnapshot = undefined;
        await pause(350, signal);
      } else if (pending.length) return result('controls-remain', true);
      else {
        stablePasses = completedPassSnapshot && sameSnapshot(completedPassSnapshot, current) ? stablePasses + 1 : 1;
        completedPassSnapshot = current;
        if (stablePasses >= 2) return result('complete', false);
        positionAtStart(root, scrollTarget);
        onProgress({ round: rounds, clicked: 0, commentCount: current.commentCount, message: '第一輪已到底，正在從留言起點進行完整核對…' });
        await pause(350, signal);
        previous = normalizeSnapshot(getSnapshot());
      }
    }
  }
  return result(signal.aborted ? 'aborted' : 'limit-reached');
}
