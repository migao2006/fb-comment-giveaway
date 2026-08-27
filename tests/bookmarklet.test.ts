// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = (id: string, participant: string) => `
  <article data-post-id="${id}">
    <header data-post-author><a href="/host">主辦人</a></header>
    <article data-comment-id="${id}-comment">
      <a data-comment-author href="/${participant}">${participant}</a>
      <span data-comment-body>${participant} 要參加</span>
    </article>
  </article>`;

describe('bookmarklet UI', () => {
  beforeEach(() => {
    document.querySelector('#fb-comment-giveaway-bookmarklet')?.remove();
    document.body.innerHTML = post('one', '甲');
    history.replaceState({}, '', '/posts/fixture-one');
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
    expect(host.shadowRoot!.querySelector('[data-candidates]')!.textContent).toContain('主辦人');
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
    expect(shadow.querySelector('[data-stat="total"]')!.textContent).toBe('1');
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
  it('shows separate main-comment and reply counters', async () => {
    document.body.innerHTML = `<article><a href="/host">主辦人</a>
      <article data-comment-id="main"><a href="/a">甲</a><span dir="auto">主留言</span>
        <article data-comment-id="reply" data-comment-depth="1"><a href="/b">乙</a><span dir="auto">回覆內容</span></article>
      </article>
    </article>`;
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    expect(shadow.querySelector('[data-stat="comments"]')!.textContent).toBe('1');
    expect(shadow.querySelector('[data-stat="replies"]')!.textContent).toBe('1');
    expect(shadow.querySelector('.badge')!.textContent).toContain('v0.3.1');
  });

  it('shows and searches the raw comment list independently of raffle filters', async () => {
    document.body.innerHTML = `<article><a href="/host">主辦人</a>
      <article data-comment-id="main"><a href="/a">甲</a><span dir="auto">參加抽獎</span>
        <article data-comment-id="reply" data-comment-depth="1"><a href="/b">乙</a><span dir="auto">只是回覆</span></article>
      </article>
    </article>`;
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    expect(shadow.querySelector('[data-stat="total"]')!.textContent).toBe('2');
    expect(shadow.querySelectorAll('.comment-card')).toHaveLength(2);
    expect(shadow.querySelectorAll('[data-action^="export-"]')).toHaveLength(3);
    const search = shadow.querySelector<HTMLInputElement>('[name="commentSearch"]')!;
    search.value = '只是回覆';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(shadow.querySelectorAll('.comment-card')).toHaveLength(1);
    expect(shadow.querySelector('[data-comment-list-summary]')!.textContent).toContain('搜尋只影響畫面');
    expect(shadow.querySelector('[data-candidates]')!.textContent).toContain('1 個抽獎資格');
  });

  it('shows the difference from Facebook reported total', async () => {
    document.body.innerHTML = `<article><a href="/host">主辦人</a><div role="button" aria-label="167 則留言，按兩下即可查看留言"></div>
      <article data-comment-id="main"><a href="/a">甲</a><span dir="auto">參加</span></article></article>`;
    await import('../src/bookmarklet');
    const coverage = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!.querySelector<HTMLElement>('[data-coverage]')!;
    expect(coverage.textContent).toContain('Facebook 顯示 167 則');
    expect(coverage.textContent).toContain('尚差 166 則');
  });

  it('reads the reported total only from the selected post root', async () => {
    document.body.innerHTML = `<div role="button" aria-label="999 則留言，按兩下即可查看留言"></div>
      <article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
        <div role="button" aria-label="1 則留言，按兩下即可查看留言"></div>
        <article data-comment-id="main"><a href="/a">甲</a><span data-comment-body>參加</span></article>
      </article>`;
    await import('../src/bookmarklet');
    const coverage = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!.querySelector<HTMLElement>('[data-coverage]')!;
    expect(coverage.textContent).toContain('Facebook 顯示 1 則');
    expect(coverage.textContent).not.toContain('999');
  });

  it('does not claim completion when Facebook reports more comments than the snapshot', async () => {
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
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('尚有 2 則');
    expect(shadow.querySelector('[data-status]')!.textContent).not.toContain('✅ 已完成載入');
    vi.useRealTimers();
  });

  it('claims verified completion only when the post total matches and no controls remain', async () => {
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
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('✅ 已完成載入');
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('1 則主留言、0 則回覆');
    vi.useRealTimers();
  });

  it('does not claim completion while an explicit reply control remains rendered', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    document.body.innerHTML = `<article data-post-id="one"><header data-post-author><a href="/host">主辦人</a></header>
      <div role="button" aria-label="2 則留言，按兩下即可查看留言"></div>
      <article data-comment-id="main"><a href="/a">甲</a><span data-comment-body>參加</span></article>
      <button id="reply-control">查看1則回覆</button>
    </article>`;
    const replyControl = document.querySelector<HTMLButtonElement>('#reply-control')!;
    replyControl.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40 } as DOMRect);
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    (shadow.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('仍有留言或回覆尚未展開');
    expect(shadow.querySelector('[data-status]')!.textContent).not.toContain('✅ 已完成載入');
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
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await import('../src/bookmarklet');
    const shadow = document.querySelector<HTMLElement>('#fb-comment-giveaway-bookmarklet')!.shadowRoot!;
    expect(shadow.querySelector('[data-stat="total"]')!.textContent).toBe('2');
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(shadow.querySelector('[data-comment-copy-state]')!.textContent).toMatch(/^已下載 2 則 CSV（資料快照 #\d+）。$/);
  });

  it('invalidates a completed snapshot when Facebook adds comments before export', async () => {
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
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('✅ 已完成載入');

    document.querySelector('#reported')!.setAttribute('aria-label', '2 則留言，按兩下即可查看留言');
    (shadow.querySelector('[data-action="export-csv"]') as HTMLButtonElement).click();
    expect(shadow.querySelector('[data-status]')!.textContent).toContain('Facebook 留言已更新');
    expect(shadow.querySelector('[data-coverage]')!.textContent).toContain('尚差 1 則');
    expect(shadow.querySelector('[data-comment-copy-state]')!.textContent).toContain('已下載 1 則 CSV');
    vi.useRealTimers();
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
