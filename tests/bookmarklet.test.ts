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
    expect(shadow.querySelector('.badge')!.textContent).toContain('v0.3.0');
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
});
