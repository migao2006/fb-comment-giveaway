import type { FacebookComment, ParsedFacebookPost } from './types';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** Normalizes Facebook profile links so tracking parameters do not create duplicate entrants. */
export function canonicalProfileUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, typeof location === 'undefined' ? 'https://facebook.com/' : location.href);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'mbasic.facebook.com') {
      const id = url.searchParams.get('id');
      url.protocol = 'https:';
      url.hostname = 'facebook.com';
      url.hash = '';
      const groupUser = url.pathname.match(/^\/groups\/[^/]+\/user\/(\d+)(?:\/|$)/i);
      if (groupUser) {
        url.pathname = '/profile.php';
        url.search = `?id=${encodeURIComponent(groupUser[1]!)}`;
      } else if (url.pathname.toLowerCase() === '/profile.php' && id) {
        url.search = `?id=${encodeURIComponent(id)}`;
      } else {
        url.search = '';
        url.pathname = url.pathname.replace(/\/$/, '') || '/';
        if (/^\/(?:watch|reel|reels|posts|groups|photo|photos|permalink|events|marketplace|help|hashtag)(?:\/|$)/i.test(url.pathname)) return undefined;
      }
    } else { return undefined; }
    return url.href;
  } catch {
    return undefined;
  }
}

/** Parses the date formats Facebook commonly exposes in its Chinese UI. */
export function parseFacebookDate(value: string | null | undefined): string | undefined {
  const text = clean(value);
  if (!text) return undefined;
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  const match = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/);
  if (!match) return undefined;
  const [, year, month, day, hour = '0', minute = '0'] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).toISOString();
}

function findAuthor(node: Element): { name: string; url?: string } | undefined {
  const marked = node.querySelector<HTMLElement>('[data-comment-author]');
  if (marked) {
    const link = marked.matches('a') ? marked as HTMLAnchorElement : marked.querySelector<HTMLAnchorElement>('a[href]');
    const name = clean(marked.textContent);
    if (name) {
      const url = canonicalProfileUrl(link?.getAttribute('href') ?? null);
      return url ? { name, url } : { name };
    }
  }
  const links = [...node.querySelectorAll<HTMLAnchorElement>('a[href]')];
  const link = links.find((item) => {
    const name = clean(item.textContent);
    const href = item.getAttribute('href') ?? '';
    return Boolean(name) && !/comment|reply|reaction|hashtag/i.test(href) && !/更多|回覆|讚|留言/.test(name);
  });
  if (!link) return undefined;
  const url = canonicalProfileUrl(link.getAttribute('href'));
  return url ? { name: clean(link.textContent), url } : { name: clean(link.textContent) };
}

const semanticCommentSelector = '[data-comment-id], article[aria-label*="留言"], [role="article"][aria-label*="留言"], article[aria-label*="回覆"], [role="article"][aria-label*="回覆"]';

function withoutNestedComments(node: Element): Element {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll(semanticCommentSelector).forEach((nested) => nested.remove());
  return clone;
}

function findBody(node: Element, authorName: string): string {
  const scope = withoutNestedComments(node);
  const marked = scope.querySelector<HTMLElement>('[data-comment-body]');
  if (marked) return clean(marked.textContent);
  const candidates = [...scope.querySelectorAll<HTMLElement>('[dir="auto"], [lang], span')]
    .map((item) => clean(item.textContent))
    .filter((text) => text && text !== authorName && !/^(讚|回覆|更多|查看.*回覆)$/.test(text));
  return candidates.sort((a, b) => b.length - a.length)[0] ?? '';
}

function commentNodes(root: ParentNode): Element[] {
  const marked = [...root.querySelectorAll('[data-comment-id]')];
  if (marked.length) return marked;
  return [...root.querySelectorAll(semanticCommentSelector)];
}

function postIdentity(value: string): string {
  try {
    const url = new URL(value, typeof location === 'undefined' ? 'https://facebook.com/' : location.href);
    const path = url.pathname.replace(/\/$/, '');
    const important = ['story_fbid', 'fbid', 'id', 'v']
      .map((key) => [key, url.searchParams.get(key)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
    return important.length ? `${path}?${new URLSearchParams(important.map(([key, value]) => [key, value])).toString()}` : path;
  } catch { return ''; }
}

/** Selects one post instead of accidentally combining every post in a feed. */
export function findFacebookPostRoot(
  root: ParentNode = document,
  sourceUrl = typeof location === 'undefined' ? '' : location.href,
): ParentNode | undefined {
  const currentIdentity = sourceUrl ? postIdentity(sourceUrl) : '';
  const rootElement = 'matches' in root && typeof root.matches === 'function' ? root as Element : undefined;
  const allArticles = [
    ...(rootElement?.matches('article, [role="article"]') ? [rootElement as HTMLElement] : []),
    ...root.querySelectorAll<HTMLElement>('article, [role="article"]'),
  ];
  const candidates = allArticles
    .filter((article) => !article.matches('[data-comment-id]'))
    .filter((article) => !/留言|回覆/.test(article.getAttribute('aria-label') ?? ''))
    .filter((article) => commentNodes(article).some((comment) => comment !== article))
    .filter((article, _index, all) => !all.some((parent) => parent !== article && parent.contains(article)));
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return undefined;
  const permalinkMatches = candidates.filter((article) => currentIdentity && [...article.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .some((link) => postIdentity(link.href) === currentIdentity));
  return permalinkMatches.length === 1 ? permalinkMatches[0] : undefined;
}

/**
 * Extracts only information exposed in the rendered page. It intentionally uses
 * semantic/data attributes and links, never Facebook's generated CSS classes.
 */
export function parseFacebookPost(
  root: ParentNode = document,
  sourceUrl = typeof location === 'undefined' ? '' : location.href,
): ParsedFacebookPost {
  const scope = findFacebookPostRoot(root, sourceUrl);
  const diagnostics: string[] = [];
  if (!scope) return { comments: [], replies: [], diagnostics: ['無法唯一定位目前貼文，請開啟貼文的獨立頁面後重試'] };
  const postAuthorNode = scope.querySelector<HTMLElement>('[data-post-author]');
  let postAuthor = postAuthorNode ? findAuthor(postAuthorNode) ?? { name: clean(postAuthorNode.textContent) } : undefined;
  const nodes = commentNodes(scope);
  if (!postAuthor) {
    // Facebook puts a post header before its comment articles. Do not mistake a
    // nested rendered comment for the post author when data attributes are absent.
    const commentSet = new Set(nodes);
    const postArticle = [...scope.querySelectorAll('article, [role="article"]')]
      .find((article) => !commentSet.has(article) && Boolean(article.querySelector('a[href]')));
    const authorScope = postArticle ?? scope;
    const profile = [...authorScope.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .find((link) => !nodes.some((comment) => comment.contains(link)) && Boolean(clean(link.textContent)) && Boolean(canonicalProfileUrl(link.getAttribute('href'))));
    if (profile) {
      const url = canonicalProfileUrl(profile.getAttribute('href'));
      const name = clean(profile.textContent);
      postAuthor = url ? { name, url } : { name };
    }
  }
  const seen = new Set<string>();
  const comments: FacebookComment[] = [];
  const replies: FacebookComment[] = [];

  nodes.forEach((node, index) => {
    const author = findAuthor(node);
    if (!author?.name) { diagnostics.push(`第 ${index + 1} 個留言找不到作者`); return; }
    const id = node.getAttribute('data-comment-id') || node.getAttribute('id') || `rendered-${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    const timestamp = node.querySelector<HTMLElement>('time[datetime], [data-comment-time], a[aria-label*="年"], a[aria-label*="月"]');
    const parentComment = node.parentElement?.closest('[data-comment-id]');
    const isReply = node.getAttribute('data-comment-depth') !== null
      ? Number(node.getAttribute('data-comment-depth')) > 0
      : Boolean(parentComment) || /回覆/.test(node.getAttribute('aria-label') ?? '');
    const timestampValue = timestamp?.getAttribute('datetime') || timestamp?.getAttribute('data-comment-time') || timestamp?.getAttribute('aria-label') || timestamp?.textContent;
    const createdAt = parseFacebookDate(timestampValue);
    const item: FacebookComment = {
      id,
      authorName: author.name,
      ...(author.url ? { authorUrl: author.url } : {}),
      body: findBody(node, author.name),
      ...(createdAt ? { createdAt } : {}),
      kind: isReply ? 'reply' : 'comment',
    };
    (isReply ? replies : comments).push(item);
  });
  if (!nodes.length) diagnostics.push('找不到可辨識的留言節點');
  return { ...(postAuthor ? { postAuthor } : {}), comments, replies, diagnostics };
}
