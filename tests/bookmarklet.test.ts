// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = (id: string, participant: string) => `
  <article data-post-id="${id}">
    <header data-post-author><a href="/host">主辦人</a></header>
    <article data-comment-id="${id}-comment">
      <a data-comment-author href="/${participant}">${participant}</a>
      <span data-comment-body>${participant} 要參加</span>
    </article>
  </article>`;

describe('bookmarklet UI', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (navigator as unknown as Record<string, unknown>).share;
    delete (navigator as unknown as Record<string, unknown>).canShare;
  });

  beforeEach(() => {
    document.querySelector('#fb-comment-giveaway-bookmarklet')?.remove();
    document.body.innerHTML = post('one', '甲');
    history.replaceState({}, '', '/posts/fixture-one');
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.resetModules();
  });

  it('mounts once and resets accumulated comments after Facebook SPA navigation', async () => {
    await import('../src/bookmarklet');
    const host = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!;
    expect(host).toBeTruthy();
    expect(host.shadowRoot!.querySelector('[data-stat="comments"]')!.textContent).toBe('1');

    document.body.innerHTML = post('two', '乙');
    history.pushState({}, '', '/posts/fixture-two');
    vi.resetModules();
    await import('../src/bookmarklet');

    expect(document.querySelectorAll('#fb-comment-giveaway-bookmarklet')).toHaveLength(1);
    expect(host.shadowRoot!.querySelector('[data-stat="comments"]')!.textContent).toBe('1');
    expect(host.shadowRoot!.querySelector('[data-candidates]')!.textContent).toBe('符合：1 位');
  });
  it('automatically refreshes the visible snapshot after SPA navigation mutates the page', async () => {
    await import('../src/bookmarklet');
    const host = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!;
    document.body.innerHTML = post('two', '乙');
    history.pushState({}, '', '/posts/fixture-two');
    await Promise.resolve();
    await Promise.resolve();
    expect(host.shadowRoot!.querySelector('.comment-card strong')!.textContent).toBe('乙');
    expect(host.shadowRoot!.querySelector('[data-status]')!.textContent).toContain('切換貼文');
  });
  it('keeps duplicate-looking rendered comments as distinct records', async () => {
    document.body.innerHTML = `<article data-post-id="same"><a href="/host">主辦人</a>
      <article aria-label="甲的留言"><a href="/a">甲</a><span dir="auto">參加</span></article>
      <article aria-label="甲的留言"><a href="/a">甲</a><span dir="auto">參加</span></article>
    </article>`;
    await import('../src/bookmarklet');
    const host = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!;
    expect(host.shadowRoot!.querySelector('[data-stat="comments"]')!.textContent).toBe('2');
  });
  it('reconciles a truncated rendered row when Facebook replaces it with the full row', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="replace"><a href="/host">主辦人</a>
      <article aria-label="甲的留言"><a href="/a">甲</a><span data-comment-body>這是截斷內容…</span><button id="more">查看更多</button></article>
    </article>`;
    const more = document.querySelector<HTMLButtonElement>('#more')!;
    more.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
    more.addEventListener('click', () => {
      more.closest('article')!.outerHTML = `<article aria-label="甲的留言"><a href="/a">甲</a><span data-comment-body>這是截斷內容，現在已經完整展開</span></article>`;
    });
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(shadow.querySelector('[data-stat="comments"]')!.textContent).toBe('1');
    expect(shadow.querySelector('.comment-card p')!.textContent).toBe('這是截斷內容，現在已經完整展開');
    vi.useRealTimers();
  });
  it('refuses to draw an old list after SPA navigation without reactivation', async () => {
    await import('../src/bookmarklet');
    const host = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!;
    document.body.innerHTML = post('new', '新參加者');
    history.pushState({}, '', '/posts/new');
    (host.shadowRoot!.querySelector('[data-action="draw"]') as HTMLButtonElement).click();
    expect(host.shadowRoot!.querySelector('[data-status]')!.textContent).toContain('切換貼文');
    expect(host.shadowRoot!.querySelector('[data-results]')!.classList.contains('hidden')).toBe(true);
  });
  it('shows an error code when a post cannot be located', async () => {
    document.body.innerHTML = '<main role="main">尚未載入貼文</main>';
    await import('../src/bookmarklet');
    const error = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!.querySelector<HTMLElement>('[data-error]')!;
    expect(error.classList.contains('hidden')).toBe(false);
    expect(error.textContent).toContain('POST_NOT_FOUND');
  });
  it('always exposes the partial-loading diagnostic action', async () => {
    await import('../src/bookmarklet');
    const host = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!;
    expect(host.shadowRoot!.querySelectorAll('[data-action="copy-load-diagnostic"]')).toHaveLength(1);
    expect(host.shadowRoot!.querySelector('.advanced')?.textContent).toContain('問題診斷');
  });
  it('shows only main-comment statistics and ignores rendered replies', async () => {
    document.body.innerHTML = `<article><a href="/host">主辦人</a>
      <article data-comment-id="main"><a href="/a">甲</a><span dir="auto">主留言</span>
        <article data-comment-id="reply" data-comment-depth="1"><a href="/b">乙</a><span dir="auto">回覆內容</span></article>
      </article>
    </article>`;
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    expect(shadow.querySelector('[data-stat="comments"]')!.textContent).toBe('1');
    expect(shadow.querySelector('[data-stat="authors"]')!.textContent).toBe('1');
    expect(shadow.querySelector('[data-stat="duplicates"]')!.textContent).toBe('0');
    expect(shadow.querySelector('[data-stat="replies"]')).toBeNull();
    expect(shadow.querySelector('.badge')!.textContent).toContain('v0.3.5');
  });

  it('shows and searches the raw comment list independently of raffle filters', async () => {
    document.body.innerHTML = `<article><a href="/host">主辦人</a>
      <article data-comment-id="main"><a href="/a">甲</a><span dir="auto">參加抽獎</span>
        <article data-comment-id="reply" data-comment-depth="1"><a href="/b">乙</a><span dir="auto">只是回覆</span></article>
      </article>
    </article>`;
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    expect(shadow.querySelector('[data-stat="comments"]')!.textContent).toBe('1');
    expect(shadow.querySelectorAll('.comment-card')).toHaveLength(1);
    expect(shadow.querySelectorAll('[data-action^="export-"]')).toHaveLength(1);
    expect(shadow.querySelector('[data-action="copy-comments"]')).toBeNull();
    expect(shadow.querySelector('[data-action="export-txt"]')).toBeNull();
    expect(shadow.querySelector('[data-action="export-json"]')).toBeNull();
    const search = shadow.querySelector<HTMLInputElement>('[name="commentSearch"]')!;
    search.value = '只是回覆';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(shadow.querySelectorAll('.comment-card')).toHaveLength(0);
    expect(shadow.querySelector('[data-comment-list-summary]')!.textContent).toBe('顯示 0／1 則');
    expect(shadow.querySelector('[data-candidates]')!.textContent).toBe('符合：1 位');
  });

  it('does not compare main comments with Facebook aggregate totals that may include replies', async () => {
    document.body.innerHTML = `<article><a href="/host">主辦人</a><div role="button" aria-label="167 則留言，按兩下即可查看留言"></div>
      <article data-comment-id="main"><a href="/a">甲</a><span dir="auto">參加</span></article></article>`;
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    expect(shadow.querySelector('[data-comment-list-summary]')!.textContent).not.toContain('167');
    expect(shadow.querySelector('[data-action="load"]')!.textContent).toContain('全部主留言');
  });

  it('completes main-comment loading even when Facebook aggregate total is larger', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <div role="button" aria-label="3 則留言，按兩下即可查看留言"></div>
      <article data-comment-id="main"><a href="/a">甲</a><span data-comment-body>參加</span></article>
    </article>`;
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('✅ 載入完成');
    expect(shadow.querySelector('[data-coverage]')!.textContent).toContain('1 則主留言');
    vi.useRealTimers();
  });

  it('claims main-comment completion after two stable passes', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <div role="button" aria-label="1 則留言，按兩下即可查看留言"></div>
      <article data-comment-id="main"><a href="/a">甲</a><span data-comment-body>參加</span></article>
    </article>`;
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('✅ 載入完成');
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('1 則主留言');
    vi.useRealTimers();
  });

  it('does not click or wait for an explicit reply control', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <div role="button" aria-label="2 則留言，按兩下即可查看留言"></div>
      <article data-comment-id="main"><a href="/a">甲</a><span data-comment-body>參加</span></article>
      <button id="reply-control">查看1則回覆</button>
    </article>`;
    const replyControl = document.querySelector<HTMLButtonElement>('#reply-control')!;
    replyControl.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
    const replyClick = vi.fn();
    replyControl.addEventListener('click', replyClick);
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(replyClick).not.toHaveBeenCalled();
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('✅ 載入完成');
    vi.useRealTimers();
  });

  it('reports the exact displayed snapshot size after CSV export', async () => {
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <article data-comment-id="main"><a href="/a">甲</a><span data-comment-body>主留言</span>
        <article data-comment-id="reply" data-comment-depth="1"><a href="/b">乙</a><span data-comment-body>回覆</span></article>
      </article>
    </article>`;
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let downloadedFilename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadedFilename = this.download; });
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    expect(shadow.querySelector('[data-stat="comments"]')!.textContent).toBe('1');
    expect(shadow.querySelectorAll('.comment-card')).toHaveLength(1);
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(downloadedFilename).toBe('facebook-comments-partial.csv');
    expect(shadow.querySelector('[data-comment-copy-state]')!.textContent).toBe('CSV 已下載（1 則）。');
  });

  it('uses the iPhone share sheet so CSV can be saved to Files', async () => {
    const userAgent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)');
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(canShare).toHaveBeenCalled();
    expect(share).toHaveBeenCalledTimes(1);
    const file = share.mock.calls[0]?.[0]?.files?.[0] as File;
    expect(file.name).toBe('facebook-comments-partial.csv');
    expect(file.type).toBe('text/csv;charset=utf-8');
    expect(shadow.querySelector('[data-comment-copy-state]')!.textContent).toContain('CSV 已儲存／分享');
    delete (navigator as unknown as Record<string, unknown>).share;
    delete (navigator as unknown as Record<string, unknown>).canShare;
    userAgent.mockRestore();
  });

  it('opens a persistent CSV link on iPhone when file sharing is unavailable', async () => {
    const userAgent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)');
    const canShare = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:iphone-csv');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('blob:iphone-csv', '_blank');
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    const fallback = shadow.querySelector<HTMLAnchorElement>('[data-comment-copy-state] a')!;
    expect(fallback.href).toBe('blob:iphone-csv');
    expect(fallback.download).toBe('facebook-comments-partial.csv');
    expect(fallback.textContent).toContain('儲存到檔案');
    delete (navigator as unknown as Record<string, unknown>).canShare;
    userAgent.mockRestore();
    open.mockRestore();
  });

  it('does not export partial data when the user cancels the confirmation', async () => {
    vi.mocked(confirm).mockReturnValue(false);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    createObjectUrl.mockClear();
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    expect(confirm).toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('uses the normal CSV filename after main-comment loading completes', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <div role="button" aria-label="1 則留言，按兩下即可查看留言"></div>
      <article data-comment-id="main"><a href="/a">甲</a><span data-comment-body>參加</span></article>
    </article>`;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let downloadedFilename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadedFilename = this.download; });
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(downloadedFilename).toBe('facebook-comments.csv');
    vi.useRealTimers();
  });

  it('does not invalidate main comments when only Facebook aggregate total changes', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <div id="reported" role="button" aria-label="1 則留言，按兩下即可查看留言"></div>
      <article data-comment-id="main"><a href="/a">甲</a><span data-comment-body>參加</span></article>
    </article>`;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('✅ 載入完成');

    document.querySelector('#reported')!.setAttribute('aria-label', '2 則留言，按兩下即可查看留言');
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('✅ 載入完成');
    expect(shadow.querySelector('[data-coverage]')!.textContent).toContain('1 則主留言');
    expect(shadow.querySelector('[data-comment-copy-state]')!.textContent).toContain('CSV 已下載（1 則');
    vi.useRealTimers();
  });

  it('downgrades and includes a newly rendered main comment before exporting', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <article data-comment-id="main"><a data-comment-author href="/a">甲</a><span data-comment-body>參加</span></article>
    </article>`;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let downloadedFilename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadedFilename = this.download; });
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const newComment = document.createElement('article');
    newComment.setAttribute('data-comment-id', 'new-main');
    newComment.innerHTML = '<a data-comment-author href="/b">乙</a><span data-comment-body>我也參加</span>';
    document.querySelector('article[data-post-id="one"]')!.append(newComment);
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(confirm).toHaveBeenCalled();
    expect(downloadedFilename).toBe('facebook-comments-partial.csv');
    expect(shadow.querySelector('[data-stat="comments"]')!.textContent).toBe('2');
    expect(shadow.querySelector('[data-coverage]')!.textContent).toContain('尚未完成');
    vi.useRealTimers();
  });

  it('draws from the refreshed main-comment snapshot', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <article data-comment-id="main"><a data-comment-author href="/a">甲</a><span data-comment-body>參加</span></article>
    </article>`;
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    shadow.querySelector<HTMLElement>('[data-results]')!.scrollIntoView = vi.fn();
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const newComment = document.createElement('article');
    newComment.setAttribute('data-comment-id', 'new-main');
    newComment.innerHTML = '<a data-comment-author href="/b">乙</a><span data-comment-body>參加</span>';
    document.querySelector('article[data-post-id="one"]')!.append(newComment);
    (shadow.querySelector('[data-action="draw"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(shadow.querySelector('[data-status]')!.textContent).toContain('2 個抽獎資格'));
  });

  it('never carries comments from a detached loading root into its replacement', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <article data-comment-id="old"><a data-comment-author href="/profile.php?id=101">舊留言者</a><span data-comment-body>舊留言</span></article>
      <button id="replace-root">查看更多留言</button>
    </article>`;
    const replace = document.querySelector<HTMLButtonElement>('#replace-root')!;
    replace.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
    replace.addEventListener('click', () => {
      document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
        <article data-comment-id="new"><a data-comment-author href="/profile.php?id=102">新留言者</a><span data-comment-body>新留言</span></article>
      </article>`;
    });
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(shadow.querySelector('.comment-card strong')!.textContent).toBe('新留言者');
    expect(shadow.querySelector('[data-comment-list]')!.textContent).not.toContain('舊留言者');
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('留言區已更新');
    vi.useRealTimers();
  });

  it('never re-parses a still-connected old root after navigation during loading', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <article data-comment-id="old"><a data-comment-author href="/profile.php?id=201">舊留言者</a><span data-comment-body>舊留言</span></article>
      <button id="navigate-with-old-root">查看更多留言</button>
    </article>`;
    const navigate = document.querySelector<HTMLButtonElement>('#navigate-with-old-root')!;
    navigate.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
    navigate.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', `<article data-post-id="two"><header data-post-author><a href="/host">主辦人</a></header>
        <a href="/posts/fixture-two">目前貼文</a>
        <article data-comment-id="new"><a data-comment-author href="/profile.php?id=202">新留言者</a><span data-comment-body>新留言</span></article>
      </article>`);
      history.pushState({}, '', '/posts/fixture-two');
    });
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(shadow.querySelector('.comment-card strong')!.textContent).toBe('新留言者');
    expect(shadow.querySelector('[data-comment-list]')!.textContent).not.toContain('舊留言者');
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('已切換到其他貼文');
    vi.useRealTimers();
  });
});
