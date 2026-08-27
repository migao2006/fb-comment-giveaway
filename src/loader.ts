export interface LoadingProgress {
  round: number;
  clicked: number;
  commentCount: number;
  message: string;
}

const MORE_COMMENT_PATTERNS = [
  /^查看更多留言(?:（\d+）)?$/,
  /^顯示更多留言$/,
  /^更多留言$/,
  /^查看更多留言$/,
  /^查看先前的留言$/,
  /^查看另?\s*\d+\s*則留言$/,
];

const textOf = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function findMoreCommentButtons(root: ParentNode): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>('button, [role="button"]');
  return [...candidates].filter((element) => {
    const text = textOf(element);
    return isVisible(element)
      && MORE_COMMENT_PATTERNS.some((pattern) => pattern.test(text))
      && !/回覆/.test(text);
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
): Promise<void> {
  const maxRounds = 40;
  let stagnantRounds = 0;
  let previousCount = getCommentCount();
  const clicked = new WeakSet<HTMLElement>();

  for (let round = 1; round <= maxRounds && !signal.aborted; round += 1) {
    if (root instanceof Element && !root.isConnected) return;
    const buttons = findMoreCommentButtons(root).filter((button) => !clicked.has(button)).slice(0, 3);
    buttons.forEach((button) => { clicked.add(button); button.click(); });
    window.scrollBy({ top: Math.max(window.innerHeight * 0.72, 460), behavior: 'smooth' });
    onProgress({
      round,
      clicked: buttons.length,
      commentCount: previousCount,
      message: buttons.length ? '正在等待 Facebook 載入留言…' : '正在往下尋找更多留言…',
    });
    await pause(buttons.length ? 1100 : 750, signal);
    const currentCount = getCommentCount();
    stagnantRounds = currentCount > previousCount ? 0 : stagnantRounds + 1;
    previousCount = currentCount;
    onProgress({ round, clicked: buttons.length, commentCount: currentCount, message: `已辨識 ${currentCount} 則主留言` });
    if (stagnantRounds >= 3) return;
  }
}
