import type { FacebookComment, ParsedFacebookPost } from './types';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const renderedNodeIds = new WeakMap<Element, string>();
let renderedNodeCounter = 0;

function renderedNodeId(node: Element): string {
  const existing = renderedNodeIds.get(node);
  if (existing) return existing;
  const id = `rendered-node-${++renderedNodeCounter}`;
  renderedNodeIds.set(node, id);
  return id;
}

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

interface AriaCommentInfo {
  authorName?: string;
  replyToAuthorName?: string;
  isReply: boolean;
}

const privateUseCharacters = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const privateUseCharactersGlobal = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;
const urlLikeText = /^(?:https?:\/\/|www\.)|(?:facebook\.com|fb\.com)\//iu;
const timeLikeText = /^(?:\d+\s*)?(?:剛剛|\d+\s*(?:分鐘|小時|天|週|星期|個月|年)(?:前)?|\d{1,2}:\d{2})$/u;

function withoutPrivateUseCharacters(value: string | null | undefined): string {
  return clean((value ?? '').replace(privateUseCharactersGlobal, ''));
}

function isUsablePersonName(value: string): boolean {
  const text = clean(value);
  return Boolean(text)
    && !privateUseCharacters.test(text)
    && !urlLikeText.test(text)
    && !timeLikeText.test(text)
    && !commentActionText.test(text)
    && !/^(?:查看|顯示|更多|按兩下|留言操作|回覆這則)/u.test(text);
}

function ariaCommentInfo(node: Element): AriaCommentInfo {
  const label = clean(node.getAttribute('aria-label'));
  if (!label) return { isReply: false };
  // VoiceOver on Facebook iPhone uses both "甲的留言" and
  // "乙回覆甲的留言／回覆".  This is more reliable than the visual text
  // because a nested reply row can otherwise inherit its parent text.
  const reply = label.match(/^(.+?)\s*回覆\s*(.+?)\s*的(?:留言|回覆)(?:剛剛|\d+\s*(?:分鐘|小時|天|週|星期|個月|年)(?:前)?)?$/u);
  if (reply) {
    const authorName = clean(reply[1]);
    const replyToAuthorName = clean(reply[2]);
    return {
      ...(isUsablePersonName(authorName) ? { authorName } : {}),
      ...(isUsablePersonName(replyToAuthorName) ? { replyToAuthorName } : {}),
      isReply: true,
    };
  }
  const own = label.match(/^(.+?)\s*的(留言|回覆)(?:剛剛|\d+\s*(?:分鐘|小時|天|週|星期|個月|年)(?:前)?)?$/u);
  if (!own) return { isReply: /回覆/u.test(label) };
  const authorName = clean(own[1]);
  return { ...(isUsablePersonName(authorName) ? { authorName } : {}), isReply: own[2] === '回覆' };
}

function findAuthor(node: Element): { name: string; url?: string } | undefined {
  const marked = node.querySelector<HTMLElement>('[data-comment-author]');
  if (marked) {
    const link = marked.matches('a') ? marked as HTMLAnchorElement : marked.querySelector<HTMLAnchorElement>('a[href]');
    const name = clean(marked.textContent);
    if (isUsablePersonName(name)) {
      const url = canonicalProfileUrl(link?.getAttribute('href') ?? null);
      return url ? { name, url } : { name };
    }
  }
  const links = profileElements(node);
  const link = links.find((item) => {
    const name = profileElementName(item);
    const href = item.getAttribute('href') ?? '';
    return isUsablePersonName(name) && !/comment|reply|reaction|hashtag/i.test(href) && !/更多|回覆|讚|留言/.test(name);
  });
  if (link) {
    const url = canonicalProfileUrl(link.getAttribute('href'));
    const name = profileElementName(link);
    return url ? { name, url } : { name };
  }
  const semanticName = ariaCommentInfo(node).authorName;
  if (semanticName) return { name: semanticName };
  const name = commentTextParts(node).find(isUsablePersonName);
  return name ? { name } : undefined;
}

function profileElements(node: ParentNode): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>('a[href], [role="link"]')];
}

function profileElementName(node: HTMLElement): string {
  const text = clean(node.textContent);
  if (text) return text;
  return clean(node.getAttribute('aria-label')).replace(/(?:的)?(?:個人檔案|大頭貼照|profile|profile picture)$/i, '').trim();
}

const semanticCommentSelector = '[data-comment-id], [aria-label*="留言"], [aria-label*="回覆"], [aria-label*="Comment"], [aria-label*="Reply"]';

const commentActionText = /^(?:讚|回覆|留言|分享|更多|查看.*|已編輯|作者|最相關|所有留言|\d+\s*(?:分鐘|小時|天|週|個月|年)(?:前)?|\d+\s*(?:個?讚|則?回覆)|Like|Reply|Comment|Share)$/i;

function commentTextParts(node: Element): string[] {
  const candidates = [...node.querySelectorAll<HTMLElement>('[dir="auto"]')]
    .filter((item) => !item.querySelector('[dir="auto"]'))
    .map((item) => withoutPrivateUseCharacters(item.textContent))
    .filter((text) => text.length > 0 && !commentActionText.test(text) && !urlLikeText.test(text) && !timeLikeText.test(text));
  return [...new Set(candidates)];
}

function isMobileCommentAction(node: Element): boolean {
  const label = clean(node.getAttribute('aria-label'));
  return node.matches('button, [role="button"]')
    && /^留言.+按.+按/u.test(label)
    && !/(?:查看|更多|顯示).{0,8}留言|(?:反應|心情|按讚人數)/u.test(label);
}

function mobileCommentRows(root: ParentNode): Element[] {
  const rows = new Set<Element>();
  root.querySelectorAll<HTMLElement>('button[aria-label], [role="button"][aria-label]').forEach((signal) => {
    if (!isMobileCommentAction(signal)) return;
    let candidate = signal.parentElement;
    for (let depth = 0; candidate && depth < 3; depth += 1, candidate = candidate.parentElement) {
      const parts = commentTextParts(candidate);
      const buttons = candidate.querySelectorAll('button, [role="button"]').length;
      const hasExplicitMedia = Boolean(candidate.querySelector('[data-comment-media], img[alt*="貼圖"], img[alt*="圖片"], img[alt*="sticker" i], img[alt*="image" i]'));
      // A media-only row still has its author, but only accept that relaxed
      // shape at the action's immediate row. Otherwise a surrounding thread
      // can accidentally combine another row's author with this row's sticker.
      const mediaOnlyRow = parts.length >= 1 && hasExplicitMedia && signal.parentElement === candidate;
      if ((parts.length >= 2 || mediaOnlyRow) && buttons <= 12) {
        rows.add(candidate);
        break;
      }
    }
  });
  // A main mobile row legitimately contains its reply rows.  Keep both rows:
  // the parser removes the nested row only while reading the parent's body.
  // Dropping containers merely because they contain another detected row was
  // the reason main comments disappeared whenever an iPhone reply was open.
  return [...rows];
}

function indentedMobileReplyRows(nodes: Element[]): Set<Element> {
  const positioned = nodes.map((node) => {
    const authorText = [...node.querySelectorAll<HTMLElement>('[dir="auto"]')]
      .find((item) => !item.querySelector('[dir="auto"]') && !commentActionText.test(clean(item.textContent)));
    const rect = authorText?.getBoundingClientRect();
    return rect && rect.width > 0 ? { node, left: rect.left } : undefined;
  }).filter((item): item is { node: Element; left: number } => Boolean(item));
  if (positioned.length < 2) return new Set();
  const mainColumn = Math.min(...positioned.map(({ left }) => left));
  return new Set(positioned.filter(({ left }) => left >= mainColumn + 12).map(({ node }) => node));
}

function withoutNestedComments(node: Element): Element {
  const clone = node.cloneNode(true) as Element;
  // Resolve actual nested rows before removing anything. Broad aria selectors
  // also match the mobile "留言操作" button, so deleting selector matches
  // first would erase the only signal for an unlabelled nested reply.
  commentNodes(clone)
    .filter((nested) => nested !== clone && clone.contains(nested))
    .forEach((nested) => nested.remove());
  return clone;
}

function findBody(node: Element, authorName: string): string {
  const scope = withoutNestedComments(node);
  const marked = scope.querySelector<HTMLElement>('[data-comment-body]');
  if (marked) return withoutPrivateUseCharacters(marked.textContent);
  const mobileParts = commentTextParts(scope).filter((text) => text !== authorName && !privateUseCharacters.test(text));
  if (mobileParts.length) return mobileParts[0] ?? '';
  const candidates = [...scope.querySelectorAll<HTMLElement>('[lang], span')]
    .map((item) => withoutPrivateUseCharacters(item.textContent))
    .filter((text) => text && text !== authorName && !privateUseCharacters.test(text) && !urlLikeText.test(text) && !timeLikeText.test(text) && !/^(讚|回覆|更多|查看.*回覆)$/.test(text));
  return candidates.sort((a, b) => b.length - a.length)[0] ?? '';
}

function findCommentUrl(node: Element): string | undefined {
  const scope = withoutNestedComments(node);
  const link = [...scope.querySelectorAll<HTMLAnchorElement>('a[href]')].find((anchor) => {
    try {
      const url = new URL(anchor.href);
      const host = url.hostname.replace(/^www\./i, '').toLowerCase();
      return (host === 'facebook.com' || host === 'm.facebook.com' || host === 'mbasic.facebook.com')
        && (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id'));
    } catch { return false; }
  });
  if (!link) return undefined;
  try {
    const url = new URL(link.href);
    url.hostname = 'facebook.com';
    url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch { return undefined; }
}

function findMedia(node: Element): FacebookComment['media'] | undefined {
  const scope = withoutNestedComments(node);
  const media = [...scope.querySelectorAll<HTMLElement>('[data-comment-media], img[alt]')]
    .map((element) => {
      const alt = clean(element.getAttribute('alt'));
      const explicit = element.hasAttribute('data-comment-media');
      if (!explicit && !/(?:貼圖|sticker|圖片|image|photo)/iu.test(alt)) return undefined;
      const kind = /(?:貼圖|sticker)/iu.test(alt) ? 'sticker' as const : 'image' as const;
      const rawUrl = element.getAttribute('src');
      let url: string | undefined;
      if (rawUrl) {
        try {
          const parsed = new URL(rawUrl, typeof location === 'undefined' ? 'https://facebook.com/' : location.href);
          if (/^https?:$/.test(parsed.protocol)) url = parsed.href;
        } catch { /* Keep the media marker without an unsafe URL. */ }
      }
      return { kind, ...(url ? { url } : {}) };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return media.length ? media : undefined;
}

function commentNodes(root: ParentNode): Element[] {
  const marked = [...root.querySelectorAll('[data-comment-id]')];
  if (marked.length) return marked;
  const signals = [...root.querySelectorAll(semanticCommentSelector)];
  const direct = signals.filter((node) => {
    const label = clean(node.getAttribute('aria-label'));
    return !/^(?:留言|回覆|Comments?|Replies?)$/i.test(label) && isPlausibleCommentContainer(node);
  });
  const mobileRows = mobileCommentRows(root)
    .filter((row) => !direct.some((node) => node === row || node.contains(row) || row.contains(node)));
  if (direct.length || mobileRows.length) return [...direct, ...mobileRows].sort(compareDomOrder);

  const derived = new Set<Element>();
  signals.forEach((signal) => {
    let candidate = signal.parentElement;
    for (let depth = 0; candidate && depth < 7; depth += 1, candidate = candidate.parentElement) {
      if (candidate.matches('html, body, [role="feed"]')) break;
      if (isPlausibleCommentContainer(candidate)) { derived.add(candidate); break; }
    }
  });
  return [...derived];
}

function compareDomOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & 4 ? -1 : 1;
}

function isPlausibleCommentContainer(node: Element): boolean {
  const author = profileElements(node)
    .find((link) => Boolean(profileElementName(link)) && !/更多|回覆|讚|留言|查看/.test(profileElementName(link)));
  if (!author) return false;
  const authorName = profileElementName(author);
  return [...node.querySelectorAll<HTMLElement>('[dir="auto"], [lang], span')]
    .some((textNode) => {
      const text = clean(textNode.textContent);
      return text.length > 0 && text !== authorName && !/^(?:讚|回覆|留言|分享|Like|Reply|Comment|Share)$/i.test(text);
    });
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

function fallbackCommentThreadRoot(root: ParentNode): ParentNode | undefined {
  const comments = commentNodes(root);
  if (!comments.length) return undefined;
  let common = comments[0]?.parentElement;
  while (common && !comments.every((comment) => common!.contains(comment))) common = common.parentElement;
  if (!common || common.matches('html, body, [role="feed"]')) return undefined;

  let candidate: Element | null = common;
  for (let depth = 0; candidate && depth < 8; depth += 1, candidate = candidate.parentElement) {
    if (candidate.matches('html, body, [role="feed"]')) break;
    const hasPostAuthor = profileElements(candidate)
      .some((link) => !comments.some((comment) => comment.contains(link)) && Boolean(profileElementName(link)) && !/更多|回覆|讚|留言|查看/.test(profileElementName(link)));
    if (hasPostAuthor) return candidate;
  }
  return common;
}

function independentPostMain(root: ParentNode, sourceUrl: string): ParentNode | undefined {
  let url: URL;
  try { url = new URL(sourceUrl); } catch { return undefined; }
  if (!url.pathname || url.pathname === '/') return undefined;
  const mains = [...root.querySelectorAll<HTMLElement>('main, [role="main"]')]
    .filter((main, index, all) => !all.some((parent, parentIndex) => parentIndex !== index && parent.contains(main)));
  if (mains.length !== 1) return undefined;
  const hasCommentControl = [...mains[0]!.querySelectorAll<HTMLElement>('button, [role="button"]')]
    .some((button) => /留言|comment/i.test(clean(button.textContent) || button.getAttribute('aria-label') || ''));
  return hasCommentControl ? mains[0] : undefined;
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
  const permalinkMatches = candidates.filter((article) => currentIdentity && [...article.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .some((link) => postIdentity(link.href) === currentIdentity));
  if (permalinkMatches.length === 1) return permalinkMatches[0];
  if (candidates.length > 1) return undefined;
  return fallbackCommentThreadRoot(root) ?? independentPostMain(root, sourceUrl);
}

/**
 * Extracts only information exposed in the rendered page. It intentionally uses
 * semantic/data attributes and links, never Facebook's generated CSS classes.
 */
export function parseFacebookPost(
  root: ParentNode = document,
  sourceUrl = typeof location === 'undefined' ? '' : location.href,
  options: { includeReplies?: boolean } = {},
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
    const profile = profileElements(authorScope)
      .find((link) => !nodes.some((comment) => comment.contains(link)) && Boolean(profileElementName(link)) && !/更多|回覆|讚|留言|查看/.test(profileElementName(link)));
    if (profile) {
      const url = canonicalProfileUrl(profile.getAttribute('href'));
      const name = profileElementName(profile);
      postAuthor = url ? { name, url } : { name };
    }
  }
  const seen = new Set<string>();
  const comments: FacebookComment[] = [];
  const replies: FacebookComment[] = [];
  const inferredReplies = indentedMobileReplyRows(nodes);

  nodes.forEach((node, index) => {
    const ariaInfo = ariaCommentInfo(node);
    const id = node.getAttribute('data-comment-id') || renderedNodeId(node);
    if (seen.has(id)) return;
    seen.add(id);
    const parentComment = node.parentElement?.closest('[data-comment-id]');
    const isReply = node.getAttribute('data-comment-depth') !== null
      ? Number(node.getAttribute('data-comment-depth')) > 0
      : Boolean(parentComment) || ariaInfo.isReply || inferredReplies.has(node);
    if (isReply && options.includeReplies === false) return;
    const author = findAuthor(node);
    if (!author?.name) { diagnostics.push(`第 ${index + 1} 個留言找不到作者`); return; }
    const timestamp = node.querySelector<HTMLElement>('time[datetime], [data-comment-time], a[aria-label*="年"], a[aria-label*="月"]');
    const timestampValue = timestamp?.getAttribute('datetime') || timestamp?.getAttribute('data-comment-time') || timestamp?.getAttribute('aria-label') || timestamp?.textContent;
    const createdAt = parseFacebookDate(timestampValue);
    const replyToAuthorName = isReply
      ? ariaInfo.replyToAuthorName ?? (parentComment ? findAuthor(parentComment)?.name : undefined)
      : undefined;
    const commentUrl = findCommentUrl(node);
    const facebookId = node.getAttribute('data-comment-id') || undefined;
    const media = findMedia(node);
    const item: FacebookComment = {
      id,
      sequence: index + 1,
      authorName: author.name,
      ...(author.url ? { authorUrl: author.url } : {}),
      body: findBody(node, author.name),
      ...(createdAt ? { createdAt } : {}),
      kind: isReply ? 'reply' : 'comment',
      ...(replyToAuthorName ? { replyToAuthorName } : {}),
      ...(commentUrl ? { commentUrl } : {}),
      ...(facebookId ? { facebookId } : {}),
      ...(media ? { media } : {}),
    };
    (isReply ? replies : comments).push(item);
  });
  if (!nodes.length) diagnostics.push('找不到可辨識的留言節點');
  return { ...(postAuthor ? { postAuthor } : {}), comments, replies, diagnostics };
}
