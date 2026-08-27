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
});
