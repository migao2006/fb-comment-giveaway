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
    expect(host.shadowRoot!.querySelectorAll('[data-action="copy-load-diagnostic"]')).toHaveLength(2);
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
    expect(shadow.querySelector('.badge')!.textContent).toContain('v0.2.2');
  });
});
