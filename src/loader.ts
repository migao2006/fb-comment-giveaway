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
const accessibleTextOf = (element: Element) => `${element.getAttribute('aria-label') ?? ''} ${textOf(element)}`.replace(/\s+/g, ' ').trim();

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function findMoreCommentButtons(root: ParentNode): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>('button, [role="button"]');
  return [...candidates].filter((element) => {
    const text = textOf(element);
    const accessibleText = accessibleTextOf(element);
    return isVisible(element)
      && (MORE_COMMENT_PATTERNS.some((pattern) => pattern.test(text)) || /(?:查看|更多|先前|其他|顯示).{0,16}留言/.test(accessibleText))
      && !/(?:撰寫|新增|發表|輸入|回覆|按讚).{0,8}留言/.test(accessibleText);
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
  const clickedAtCount = new WeakMap<HTMLElement, number>();

  for (let round = 1; round <= maxRounds && !signal.aborted; round += 1) {
    if (root instanceof Element && !root.isConnected) return;
    const buttons = findMoreCommentButtons(root).filter((button) => clickedAtCount.get(button) !== previousCount).slice(0, 1);
    buttons.forEach((button) => { clickedAtCount.set(button, previousCount); button.click(); });
    const lastCommentSignal = [...root.querySelectorAll<HTMLElement>('[aria-label*="留言"], [aria-label*="Comment"]')].at(-1);
    lastCommentSignal?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
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
