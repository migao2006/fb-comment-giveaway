import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { canonicalProfileUrl, findFacebookPostRoot, parseFacebookPost } from '../src/parser';

const fixture = readFileSync(new URL('./fixtures/facebook-comments.html', import.meta.url), 'utf8');
describe('parseFacebookPost', () => {
  it('parses rendered traditional-Chinese comments without generated classes', () => {
    const result = parseFacebookPost(new JSDOM(fixture, { url: 'https://www.facebook.com/post/1' }).window.document);
    expect(result.postAuthor?.name).toBe('抽獎主辦人');
    expect(result.comments.map((item) => item.id)).toEqual(['c1', 'c2', 'c4']);
    expect(result.replies).toHaveLength(1);
    expect(result.comments[0]!).toMatchObject({ authorName: '王小明', body: '我要參加 #抽獎', kind: 'comment' });
    expect(result.comments[0]!.authorUrl).toBe('https://facebook.com/alice');
    expect(result.comments[1]!.createdAt).toContain('2026-08-21');
  });
  it('skips reply records entirely in main-comment mode', () => {
    const result = parseFacebookPost(
      new JSDOM(fixture, { url: 'https://www.facebook.com/post/1' }).window.document,
      'https://www.facebook.com/post/1',
      { includeReplies: false },
    );
    expect(result.comments.map((item) => item.id)).toEqual(['c1', 'c2', 'c4']);
    expect(result.replies).toEqual([]);
  });
  it('infers a post author from the outer post article when no marker exists', () => {
    const document = new JSDOM('<article data-post-id="post"><header><a href="https://www.facebook.com/profile.php?id=8&ref=feed#x">粉專</a></header><article data-comment-id="c"><a href="/a">留言者</a><span dir="auto">參加</span></article></article>').window.document;
    expect(parseFacebookPost(document).postAuthor).toEqual({ name: '粉專', url: 'https://facebook.com/profile.php?id=8' });
    expect(canonicalProfileUrl('https://www.facebook.com/alice/?ref=bookmarks#part')).toBe('https://facebook.com/alice');
  });
  it('isolates one post and keeps nested reply text out of the main comment body', () => {
    const html = `
      <main>
        <div role="article"><a href="/small-host">小貼文</a>
          <div role="article" aria-label="甲的留言"><a href="/a">甲</a><span dir="auto">別篇留言</span></div>
        </div>
        <div role="article"><a href="/target-host">目標貼文</a><a href="/posts/target">貼文時間</a>
          <div role="article" aria-label="乙的留言"><a href="/b">乙</a><span dir="auto">參加</span>
            <div role="article" aria-label="丙的回覆"><a href="/c">丙</a><span dir="auto">這是非常非常長的回覆文字</span></div>
          </div>
          <div role="article" aria-label="丁的留言"><a href="/d">丁</a><span dir="auto">也參加</span></div>
        </div>
      </main>`;
    const result = parseFacebookPost(new JSDOM(html, { url: 'https://facebook.com/posts/target' }).window.document, 'https://facebook.com/posts/target');
    expect(result.postAuthor?.name).toBe('目標貼文');
    expect(result.comments.map((comment) => comment.body)).toEqual(['參加', '也參加']);
    expect(result.comments.some((comment) => comment.body.includes('回覆文字'))).toBe(false);
  });
  it('rejects non-Facebook and known non-profile links as participant identities', () => {
    expect(canonicalProfileUrl('https://example.com/alice')).toBeUndefined();
    expect(canonicalProfileUrl('https://facebook.com/groups/123')).toBeUndefined();
    expect(canonicalProfileUrl('https://facebook.com/groups/123/user/456/?ref=group')).toBe('https://facebook.com/profile.php?id=456');
  });
  it('refuses to guess among posts and matches important permalink query IDs', () => {
    const html = `<main>
      <article><a href="/story.php?story_fbid=wrong&id=8">熱門貼文</a>
        <article aria-label="甲的留言"><a href="/a">甲</a><span dir="auto">1</span></article>
        <article aria-label="乙的留言"><a href="/b">乙</a><span dir="auto">2</span></article>
      </article>
      <article><a href="/story.php?story_fbid=target&id=8">目標貼文</a>
        <article aria-label="丙的留言"><a href="/c">丙</a><span dir="auto">3</span></article>
      </article>
    </main>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/story.php?story_fbid=target&id=8' }).window.document;
    expect(findFacebookPostRoot(document, 'https://facebook.com/story.php?story_fbid=target&id=8')?.querySelector('a')?.textContent).toBe('目標貼文');
    expect(findFacebookPostRoot(document, 'https://facebook.com/story.php?story_fbid=missing&id=8')).toBeUndefined();
  });
  it('finds a mobile comment thread whose post wrapper has no article role', () => {
    const html = `<main role="main"><div class="mobile-post"><header><a href="/mobile-host">手機版作者</a></header>
      <section><div role="article" aria-label="行動使用者的留言"><a href="/mobile-user">行動使用者</a><span dir="auto">手機參加</span></div></section>
    </div></main>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/mobile' }).window.document;
    const result = parseFacebookPost(document, 'https://facebook.com/posts/mobile');
    expect(result.postAuthor?.name).toBe('手機版作者');
    expect(result.comments).toMatchObject([{ authorName: '行動使用者', body: '手機參加' }]);
  });
  it('parses iPhone Facebook div comments without article, role or main elements', () => {
    const html = `<div id="mobile-shell"><header><a href="/iphone-host">iPhone 作者</a></header><section>
      <div aria-label="手機使用者的留言"><a href="/iphone-user">手機使用者</a><span dir="auto">iPhone 參加</span>
        <button aria-label="對手機使用者的留言按讚"><span>讚</span></button>
      </div>
    </section></div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/iphone' }).window.document;
    const result = parseFacebookPost(document, 'https://facebook.com/posts/iphone');
    expect(result.postAuthor?.name).toBe('iPhone 作者');
    expect(result.comments).toMatchObject([{ authorName: '手機使用者', body: 'iPhone 參加' }]);
    expect(result.comments).toHaveLength(1);
  });
  it('derives an anonymous div comment container from its labeled controls', () => {
    const html = `<div><a href="/control-host">作者</a><section><div class="comment"><a href="/control-user">參加者</a><span dir="auto">控制項參加</span><button aria-label="回覆這則留言"><span>回覆</span></button></div></section></div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/control' }).window.document;
    expect(parseFacebookPost(document, 'https://facebook.com/posts/control').comments).toMatchObject([{ authorName: '參加者', body: '控制項參加' }]);
  });
  it('parses iPhone role-link authors without anchor or href elements', () => {
    const html = `<div><header><div role="link"><span>貼文作者</span></div></header><section><div class="comment"><div role="link"><span>無網址參加者</span></div><span dir="auto">role link 參加</span><div role="button" aria-label="留言者，按兩下即可回覆"><span>回覆</span></div></div></section></div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/role-link' }).window.document;
    const result = parseFacebookPost(document, 'https://facebook.com/posts/role-link');
    expect(result.postAuthor?.name).toBe('貼文作者');
    expect(result.comments).toMatchObject([{ authorName: '無網址參加者', body: 'role link 參加' }]);
  });

  it('parses repeated iPhone comment rows whose authors are plain text', () => {
    const rows = Array.from({ length: 20 }, (_, index) => `<div class="row">
      <span dir="auto">參加者 ${index + 1}</span><span dir="auto">第 ${index + 1} 則參加留言</span>
      <div role="button" aria-label="留言操作，按兩下即可按讚"><span dir="auto">讚</span></div>
      <div role="button" aria-label="回覆這則留言"><span dir="auto">回覆</span></div>
    </div>`).join('');
    const html = `<div><header><a href="/host">主辦人</a></header><section>${rows}</section></div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/plain-authors' }).window.document;
    const result = parseFacebookPost(document, 'https://facebook.com/posts/plain-authors');
    expect(result.comments).toHaveLength(20);
    expect(result.comments[0]).toMatchObject({ authorName: '參加者 1', body: '第 1 則參加留言' });
    expect(result.comments[19]).toMatchObject({ authorName: '參加者 20', body: '第 20 則參加留言' });
    expect(result.comments.every((comment) => comment.authorUrl === undefined)).toBe(true);
  });

  it('does not treat reaction-list or more-comments controls as comments', () => {
    const html = `<div><a href="/host">作者</a><span dir="auto">59 人</span><span dir="auto">查看名單</span>
      <div role="button" aria-label="59 人，按兩下即可查看留言"></div>
      <div role="button" aria-label="查看更多留言"><span>查看更多留言</span></div>
    </div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/safe' }).window.document;
    expect(parseFacebookPost(document, 'https://facebook.com/posts/safe').comments).toHaveLength(0);
  });

  it('keeps a short comment body ahead of time and interaction metadata', () => {
    const html = `<div><a href="/host">作者</a><div class="row">
      <span dir="auto">小明</span><span dir="auto">+1</span><span dir="auto">2 小時</span><span dir="auto">12 個讚</span>
      <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
    </div></div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/short' }).window.document;
    expect(parseFacebookPost(document, 'https://facebook.com/posts/short').comments)
      .toMatchObject([{ authorName: '小明', body: '+1' }]);
  });

  it('classifies indented iPhone rows as replies instead of main comments', () => {
    const html = `<div><a href="/host">作者</a><section>
      <div class="row"><span id="main-author" dir="auto">甲</span><span dir="auto">主留言</span><div role="button" aria-label="留言操作，按兩下即可按讚"></div></div>
      <div class="row"><span id="reply-author" dir="auto">乙</span><span dir="auto">這是回覆</span><div role="button" aria-label="留言操作，按兩下即可按讚"></div></div>
    </section></div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/indented-reply' }).window.document;
    document.querySelector<HTMLElement>('#main-author')!.getBoundingClientRect = () => ({ left: 20, width: 100 } as DOMRect);
    document.querySelector<HTMLElement>('#reply-author')!.getBoundingClientRect = () => ({ left: 52, width: 100 } as DOMRect);
    const result = parseFacebookPost(document, 'https://facebook.com/posts/indented-reply');
    expect(result.comments).toMatchObject([{ authorName: '甲', body: '主留言', kind: 'comment' }]);
    expect(result.replies).toMatchObject([{ authorName: '乙', body: '這是回覆', kind: 'reply' }]);
    expect(result.replies[0]?.replyToAuthorName).toBeUndefined();
    expect(result.comments[0]?.sequence).toBeLessThan(result.replies[0]?.sequence ?? 0);
  });

  it('keeps only explicit comment permalinks, IDs, and semantic comment media', () => {
    const html = `<article><a href="/host">作者</a><article data-comment-id="c-123" aria-label="甲的留言">
      <a href="/alice"><img src="https://example.com/avatar.jpg" alt="甲的大頭貼照">甲</a>
      <span dir="auto">有圖片</span><img data-comment-media src="https://example.com/photo.jpg" alt="圖片">
      <a href="/posts/9?comment_id=123&ref=share">2 小時</a>
    </article></article>`;
    const result = parseFacebookPost(new JSDOM(html, { url: 'https://facebook.com/posts/9' }).window.document);
    expect(result.comments[0]).toMatchObject({ facebookId: 'c-123', commentUrl: 'https://facebook.com/posts/9?comment_id=123&ref=share' });
    expect(result.comments[0]?.media).toEqual([{ kind: 'image', url: 'https://example.com/photo.jpg' }]);
  });

  it('does not borrow a nested reply permalink for its parent and records an explicit parent target', () => {
    const document = new JSDOM(`<article><a href="/host">作者</a><article data-comment-id="main" aria-label="甲的留言"><a href="/a">甲</a>
      <span data-comment-body>主留言</span><article data-comment-id="reply" data-comment-depth="1"><a href="/b">乙</a><span dir="auto">回覆</span><a href="/posts/1?comment_id=2">時間</a></article>
    </article></article>`, { url: 'https://facebook.com/posts/1' }).window.document;
    const result = parseFacebookPost(document);
    expect(result.comments[0]?.commentUrl).toBeUndefined();
    expect(result.replies[0]?.replyToAuthorName).toBe('甲');
  });

  it('keeps a rendered node ID stable when its truncated body expands', () => {
    const document = new JSDOM(`<article><a href="/host">作者</a><article aria-label="甲的留言"><a href="/a">甲</a><span data-comment-body>截斷內容</span></article></article>`, { url: 'https://facebook.com/posts/1' }).window.document;
    const first = parseFacebookPost(document);
    const id = first.comments[0]?.id;
    document.querySelector('[data-comment-body]')!.textContent = '完整內容已展開';
    const second = parseFacebookPost(document);
    expect(second.comments[0]?.id).toBe(id);
    expect(second.comments[0]?.body).toBe('完整內容已展開');
  });

  it('keeps mixed semantic and mobile fallback rows in DOM order and ignores generated DOM ids', () => {
    const html = `<article><a href="/host">作者</a><section>
      <div class="row" id="generated-a"><span dir="auto">甲</span><span dir="auto">第一則</span><div role="button" aria-label="留言操作，按兩下即可按讚"></div></div>
      <article aria-label="乙的留言" id="generated-b"><a href="/b">乙</a><span dir="auto">第二則</span></article>
      <div class="row" id="generated-c"><span dir="auto">丙</span><span dir="auto">第三則</span><div role="button" aria-label="留言操作，按兩下即可按讚"></div></div>
    </section></article>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/mixed' }).window.document;
    const result = parseFacebookPost(document);
    expect(result.comments.map((comment) => comment.authorName)).toEqual(['甲', '乙', '丙']);
    expect(result.comments.map((comment) => comment.sequence)).toEqual([1, 2, 3]);
    expect(result.comments.every((comment) => comment.id.startsWith('rendered-node-'))).toBe(true);
  });

  it('keeps iPhone nested reply rows separate and trusts reply aria labels over inherited text', () => {
    const html = `<div><header><a href="/host">主辦人</a></header><section>
      <div class="row" aria-label="葉白的留言">
        <a href="/ye">葉白</a><span dir="auto">我要參加抽獎</span>
        <div class="reply-row" aria-label="白序言回覆葉白的留言">
          <a href="/bai">白序言</a><span dir="auto">葉白 必須</span>
          <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
        </div>
        <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
      </div>
      <div class="row" aria-label="陳小美回覆白序言的回覆">
        <a href="/chen">陳小美</a><span dir="auto">我也來參加</span>
        <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
      </div>
    </section></div>`;
    const result = parseFacebookPost(new JSDOM(html, { url: 'https://facebook.com/posts/iphone-replies' }).window.document);
    expect(result.comments).toMatchObject([{ authorName: '葉白', body: '我要參加抽獎', kind: 'comment' }]);
    expect(result.replies).toMatchObject([
      { authorName: '白序言', replyToAuthorName: '葉白', body: '葉白 必須', kind: 'reply' },
      { authorName: '陳小美', replyToAuthorName: '白序言', body: '我也來參加', kind: 'reply' },
    ]);
  });

  it('recognizes reply aria labels that include Facebook time suffixes', () => {
    const html = `<div><a href="/host">主辦人</a><section>
      <div class="row" aria-label="白序言回覆海綿寶的留言4小時前">
        <a href="/bai">白序言</a><span dir="auto">時間尾碼回覆</span>
        <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
      </div>
    </section></div>`;
    const result = parseFacebookPost(new JSDOM(html, { url: 'https://facebook.com/posts/timed-reply' }).window.document);
    expect(result.comments).toHaveLength(0);
    expect(result.replies).toMatchObject([
      { authorName: '白序言', replyToAuthorName: '海綿寶', body: '時間尾碼回覆', kind: 'reply' },
    ]);
  });

  it('does not drop a mobile main row or borrow text when an unlabelled reply fallback row is nested inside it', () => {
    const html = `<div><a href="/host">主辦人</a><section>
      <div class="main-row"><span id="main-author" dir="auto">阿明</span><span dir="auto">主留言內容</span>
        <div class="reply-row"><span id="reply-author" dir="auto">小華</span><span dir="auto">巢狀回覆內容</span>
          <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
        </div>
        <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
      </div>
    </section></div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/nested-fallback' }).window.document;
    document.querySelector<HTMLElement>('#main-author')!.getBoundingClientRect = () => ({ left: 20, width: 100 } as DOMRect);
    document.querySelector<HTMLElement>('#reply-author')!.getBoundingClientRect = () => ({ left: 54, width: 100 } as DOMRect);
    const result = parseFacebookPost(document);
    expect(result.comments).toMatchObject([{ authorName: '阿明', body: '主留言內容' }]);
    expect(result.replies).toMatchObject([{ authorName: '小華', body: '巢狀回覆內容' }]);
    expect(result.comments[0]?.body).not.toContain('巢狀回覆內容');
  });

  it('does not export private-use placeholders, URLs, timestamps, or actions as a mobile author/body', () => {
    const html = `<div><a href="/host">主辦人</a><section>
      <div class="row"><span dir="auto">https://facebook.com/permalink.php?comment_id=1</span><span dir="auto">9 分鐘</span>
        <span dir="auto">󳌘</span><img data-comment-media alt="貼圖" src="https://example.com/sticker.png">
        <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
      </div>
      <div class="row"><span dir="auto">小美</span><span dir="auto">󳌘</span><img data-comment-media alt="圖片" src="https://example.com/photo.png">
        <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
      </div>
    </section></div>`;
    const result = parseFacebookPost(new JSDOM(html, { url: 'https://facebook.com/posts/media-only' }).window.document);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({ authorName: '小美', body: '', media: [{ kind: 'image', url: 'https://example.com/photo.png' }] });
  });

  it('keeps valid text while removing inline private-use placeholders', () => {
    const markedHtml = `<article><a href="/host">主辦人</a>
      <article data-comment-id="marked"><a href="/a">甲</a><span data-comment-body>我要參加󳌘</span></article>
    </article>`;
    const fallbackHtml = `<div><a href="/host">主辦人</a><section>
      <div class="row"><span dir="auto">乙</span><span dir="auto">第二則󳌘留言</span>
        <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
      </div>
    </section></div>`;
    const marked = parseFacebookPost(new JSDOM(markedHtml, { url: 'https://facebook.com/posts/private-use-marked' }).window.document);
    const fallback = parseFacebookPost(new JSDOM(fallbackHtml, { url: 'https://facebook.com/posts/private-use-fallback' }).window.document);
    expect(marked.comments[0]?.body).toBe('我要參加');
    expect(fallback.comments[0]?.body).toBe('第二則留言');
  });

  it('does not borrow an unlabelled nested reply author into a media-only main comment', () => {
    const html = `<div><a href="/host">主辦人</a><section>
      <div class="main-row"><span id="main-media-author" dir="auto">阿明</span><img data-comment-media alt="貼圖" src="https://example.com/main.png">
        <div class="reply-row"><span id="nested-media-reply-author" dir="auto">小華</span><span dir="auto">巢狀回覆內容</span>
          <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
        </div>
        <div role="button" aria-label="留言操作，按兩下即可按讚"></div>
      </div>
    </section></div>`;
    const document = new JSDOM(html, { url: 'https://facebook.com/posts/media-main-with-reply' }).window.document;
    document.querySelector<HTMLElement>('#main-media-author')!.getBoundingClientRect = () => ({ left: 20, width: 100 } as DOMRect);
    document.querySelector<HTMLElement>('#nested-media-reply-author')!.getBoundingClientRect = () => ({ left: 54, width: 100 } as DOMRect);
    const result = parseFacebookPost(document);
    expect(result.comments).toMatchObject([{ authorName: '阿明', body: '', media: [{ kind: 'sticker', url: 'https://example.com/main.png' }] }]);
    expect(result.replies).toMatchObject([{ authorName: '小華', body: '巢狀回覆內容' }]);
  });

});
