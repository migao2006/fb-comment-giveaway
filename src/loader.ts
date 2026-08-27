export interface LoadingProgress {
  round: number;
  clicked: number;
  commentCount: number;
  message: string;
}

export type LoadingEndReason = 'complete' | 'limit-reached' | 'root-lost' | 'aborted';

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
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    && rect.bottom >= 0 && rect.top <= window.innerHeight;
}

function findExpansionButtons(root: ParentNode): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>('button, [role="button"]');
  return [...candidates].filter((element) => {
    const text = textOf(element);
    return isVisible(element)
      && [...MORE_COMMENT_PATTERNS, ...MORE_REPLY_PATTERNS].some((pattern) => pattern.test(text))
      && !/(?:按讚|心情|反應)/.test(text);
  });
}

const pause = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

/**
 * Conservatively loads comments by clicking only known Traditional Chinese
 * controls. It stops on user abort, repeated no-progress rounds, or a hard cap.
 */
export async function loadMoreComments(
  root: ParentNode,
  getCommentCount: () => number,
  onProgress: (progress: LoadingProgress) => void,
  signal: AbortSignal,
): Promise<LoadingEndReason> {
  const maxRounds = 60;
  let settledBottomRounds = 0;
  let previousCount = getCommentCount();
  let previousDocumentHeight = document.documentElement.scrollHeight;
  const clickedAtCount = new WeakMap<HTMLElement, number>();

  if (root instanceof HTMLElement) root.scrollIntoView?.({ block: 'start' });
  await pause(250, signal);

  for (let round = 1; round <= maxRounds && !signal.aborted; round += 1) {
    if (root instanceof Element && !root.isConnected) return 'root-lost';
    const buttons = findExpansionButtons(root).filter((button) => clickedAtCount.get(button) !== previousCount).slice(0, 4);
    buttons.forEach((button) => { clickedAtCount.set(button, previousCount); button.click(); });
    window.scrollBy({ top: Math.max(window.innerHeight * 0.72, 460), behavior: 'smooth' });
    onProgress({
      round,
      clicked: buttons.length,
      commentCount: previousCount,
      message: buttons.length ? '正在等待 Facebook 展開留言或回覆…' : '安全捲動中，正在尋找更多留言…',
    });
    await pause(buttons.length ? 1100 : 750, signal);
    const currentCount = getCommentCount();
    const currentDocumentHeight = document.documentElement.scrollHeight;
    const reachedBottom = window.scrollY + window.innerHeight >= currentDocumentHeight - 96;
    const pageGrew = currentDocumentHeight > previousDocumentHeight + 8;
    const commentsGrew = currentCount > previousCount;
    settledBottomRounds = reachedBottom && !pageGrew && !commentsGrew ? settledBottomRounds + 1 : 0;
    previousCount = currentCount;
    previousDocumentHeight = currentDocumentHeight;
    onProgress({ round, clicked: buttons.length, commentCount: currentCount, message: `已辨識 ${currentCount} 則主留言` });
    if (settledBottomRounds >= 3) return 'complete';
  }
  return signal.aborted ? 'aborted' : 'limit-reached';
}
