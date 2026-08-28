import { hasPendingExpansionControls, loadMoreComments } from './loader';
import { commentsToCsv, commentsToText, formatLocalDate, mediaLabel, orderedComments, type FullCommentExport } from './comment-export';
import { findFacebookPostRoot, parseFacebookPost } from './parser';
import { createRaffleProof, drawRaffle, filterComments, participantsFrom } from './raffle';
import type { FacebookComment, LoadVerificationStatus, ParsedFacebookPost, RaffleFilters, RaffleProof, RaffleResult } from './types';

const ROOT_ID = 'fb-comment-giveaway-bookmarklet';
const TOOL_VERSION = '0.3.2';
const facebookHost = /(^|\.)facebook\.com$/i.test(location.hostname);

if (!facebookHost) {
  alert('請先開啟 Facebook 一般貼文，再執行「FB 留言抽獎」書籤。');
} else {
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.toggleAttribute('data-hidden');
    existing.dispatchEvent(new CustomEvent('fb-giveaway:activate'));
  } else {
    mount();
  }
}

function mount(): void {
  const host = document.createElement('div');
  host.id = ROOT_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `${panelStyles()}<aside class="panel" role="dialog" aria-label="FB 留言抽獎助手">
    <header class="header">
      <div><span class="badge">本機執行 · v${TOOL_VERSION}</span><h1>FB 留言抽獎</h1></div>
      <div class="header-actions"><button class="icon" data-action="collapse" aria-label="收合面板">−</button><button class="icon" data-action="close" aria-label="關閉面板">×</button></div>
    </header>
    <div class="body">
      <section class="notice"><b>先把留言排序切成「所有留言」</b><span>工具只會讀取這個頁面已載入的內容。</span></section>
      <h2 class="section-title">留言資料</h2>
      <section class="stats" aria-live="polite">
        <div><strong data-stat="comments">0</strong><span>主留言</span></div>
        <div><strong data-stat="replies">0</strong><span>回覆</span></div>
        <div><strong data-stat="total">0</strong><span>總留言</span></div>
        <div><strong data-stat="loaded">0</strong><span>已載入</span></div>
      </section>
      <p class="coverage hidden" data-coverage></p>
      <section class="load-row">
        <button class="button secondary" data-action="scan">重新掃描</button>
        <button class="button primary" data-action="load">載入全部留言</button>
        <button class="button danger hidden" data-action="stop">停止</button>
      </section>
      <p class="status" data-status aria-live="polite">準備掃描目前頁面…</p>
      <section class="error-card hidden" data-error role="alert">
        <strong>找不到 Facebook 留言</strong><p data-error-message></p><code>錯誤代碼：POST_NOT_FOUND</code>
        <div><button class="button error-button" data-action="copy-diagnostic">複製診斷資訊</button><span data-copy-state></span></div>
      </section>
      <details class="comments-section" open>
        <summary>完整留言 <span data-comment-count>0 則</span></summary>
        <label class="comment-search">搜尋完整留言<input name="commentSearch" type="search" placeholder="搜尋留言者、內容或回覆對象"></label>
        <p class="comment-list-summary" data-comment-list-summary>尚無留言資料</p>
        <div class="comment-list" data-comment-list></div>
        <div class="raw-export-row">
          <button class="button primary" data-action="export-csv">下載 CSV</button>
          <button class="button secondary" data-action="copy-comments">複製全部留言</button>
          <button class="button secondary" data-action="export-txt">下載 TXT</button>
          <button class="button secondary" data-action="export-json">下載 JSON</button>
        </div>
        <p class="copy-state" data-comment-copy-state></p>
      </details>
      <details open>
        <summary>抽獎條件</summary>
        <div class="form-grid">
          <label class="full">留言包含關鍵字<input name="keyword" type="text" placeholder="留空代表不限制"></label>
          <label>開始日期<input name="startDate" type="date"></label>
          <label>結束日期<input name="endDate" type="date"></label>
          <label>正取人數<input name="winnerCount" type="number" min="1" max="100" value="1" inputmode="numeric"></label>
          <label>備取人數<input name="alternateCount" type="number" min="0" max="100" value="0" inputmode="numeric"></label>
          <label class="check full"><input name="excludePostAuthor" type="checkbox" checked><span>排除貼文作者</span></label>
          <label class="check full"><input name="oneEntryPerPerson" type="checkbox" checked><span>每個帳號只有一次抽獎機會</span></label>
        </div>
        <p class="candidate-summary" data-candidates>符合條件：0 位</p>
      </details>
      <button class="draw" data-action="draw" disabled>開始抽獎</button>
      <section class="results hidden" data-results>
        <h2>抽獎結果</h2>
        <div data-winners></div>
        <div data-alternates></div>
        <div class="export-row">
          <button class="button secondary" data-action="proof">匯出去識別抽獎紀錄</button>
          <button class="button ghost" data-action="full-export">匯出完整名單</button>
        </div>
      </section>
      <details class="advanced"><summary>進階功能／問題診斷</summary><div class="bottom-diagnostic"><button class="button secondary" data-action="copy-load-diagnostic">複製載入診斷</button><span data-load-copy-state></span></div></details>
      <p class="footer-note">不讀取 Cookie、密碼或 Access Token。關閉或重新整理頁面後，本次資料即消失。</p>
    </div>
  </aside>`;
  document.documentElement.append(host);

  let parsed: ParsedFacebookPost = { comments: [], replies: [], diagnostics: [] };
  let activePage = pageKey();
  const rawCommentStore = new Map<string, FacebookComment>();
  let lastSnapshot: { result: RaffleResult; proof: RaffleProof; filters: RaffleFilters; sourcePage: string; postAuthor: ParsedFacebookPost['postAuthor'] } | undefined;
  let loadController: AbortController | undefined;
  let hasLoadingAttempt = false;
  let loadOutcome = '尚未執行';
  let verificationStatus: LoadVerificationStatus = 'partial';
  let stablePasses = 0;
  let reportedCommentTotal: number | undefined;
  let snapshotRevision = 0;
  let dataSnapshot = {
    id: '0',
    capturedAt: new Date().toISOString(),
    parsed: cloneParsedPost(parsed),
    reportedCommentTotal: undefined as number | undefined,
    loadOutcome,
    pendingExpansionControls: false,
    verificationStatus: verificationStatus as LoadVerificationStatus,
    stablePasses,
  };
  const loadHistory: Array<{ round: number; clicked: number; commentCount: number; message: string }> = [];

  const query = <T extends Element>(selector: string) => shadow.querySelector<T>(selector)!;
  const status = query<HTMLElement>('[data-status]');
  const drawButton = query<HTMLButtonElement>('[data-action="draw"]');
  const loadButton = query<HTMLButtonElement>('[data-action="load"]');
  const stopButton = query<HTMLButtonElement>('[data-action="stop"]');
  const errorCard = query<HTMLElement>('[data-error]');

  function resetLoadingVerification(): void {
    hasLoadingAttempt = false;
    loadOutcome = '尚未執行';
    loadHistory.length = 0;
    verificationStatus = 'partial';
    stablePasses = 0;
  }

  function commitDataSnapshot(postRoot?: ParentNode): void {
    snapshotRevision += 1;
    dataSnapshot = {
      id: String(snapshotRevision),
      capturedAt: new Date().toISOString(),
      parsed: cloneParsedPost(parsed),
      reportedCommentTotal,
      loadOutcome,
      pendingExpansionControls: postRoot ? hasPendingExpansionControls(postRoot) : false,
      verificationStatus,
      stablePasses,
    };
  }

  function revalidateCompletedSnapshot(): boolean {
    if (dataSnapshot.verificationStatus === 'partial') return false;
    const postRoot = findFacebookPostRoot(document, activePage);
    const liveReportedTotal = postRoot ? findReportedCommentTotal(postRoot) : undefined;
    const pendingControls = postRoot ? hasPendingExpansionControls(postRoot) : false;
    const snapshotTotal = dataSnapshot.parsed.comments.length + dataSnapshot.parsed.replies.length;
    const stillVerified = liveReportedTotal !== undefined && liveReportedTotal === snapshotTotal && !pendingControls;
    const stillVisibleComplete = !pendingControls && dataSnapshot.verificationStatus === 'visible-complete'
      && liveReportedTotal === dataSnapshot.reportedCommentTotal;
    if (stillVerified) return true;
    if (stillVisibleComplete) return false;
    reportedCommentTotal = liveReportedTotal;
    loadOutcome = pendingControls ? '尚有留言未展開'
      : liveReportedTotal === undefined ? '無法驗證完整' : '載入未完整';
    verificationStatus = 'partial';
    stablePasses = 0;
    invalidateResult();
    commitDataSnapshot(postRoot);
    refreshSummary('⚠️ Facebook 留言已更新，請再次執行「載入全部留言」。');
    return false;
  }

  function currentFilters(): RaffleFilters {
    const keyword = query<HTMLInputElement>('[name="keyword"]').value.trim();
    const startDate = query<HTMLInputElement>('[name="startDate"]').value;
    const endDate = query<HTMLInputElement>('[name="endDate"]').value;
    return {
      ...(keyword ? { keyword } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      excludePostAuthor: query<HTMLInputElement>('[name="excludePostAuthor"]').checked,
      oneEntryPerPerson: query<HTMLInputElement>('[name="oneEntryPerPerson"]').checked,
    };
  }

  function refreshSummary(message?: string, refreshComments = true): void {
    const snapshotParsed = dataSnapshot.parsed;
    const filters = currentFilters();
    const filtered = filterComments(snapshotParsed.comments, snapshotParsed.postAuthor, filters);
    const eligible = participantsFrom(filtered, filters.oneEntryPerPerson !== false);
    const allAuthors = participantsFrom(snapshotParsed.comments, true);
    const duplicatePeople = allAuthors.filter((person) => person.comments.length > 1).length;
    const missingProfiles = snapshotParsed.comments.filter((comment) => !comment.authorUrl).length;
    query<HTMLElement>('[data-stat="comments"]').textContent = String(snapshotParsed.comments.length);
    query<HTMLElement>('[data-stat="replies"]').textContent = String(snapshotParsed.replies.length);
    const parsedTotal = snapshotParsed.comments.length + snapshotParsed.replies.length;
    query<HTMLElement>('[data-stat="total"]').textContent = String(parsedTotal);
    query<HTMLElement>('[data-stat="loaded"]').textContent = String(parsedTotal);
    const coverage = query<HTMLElement>('[data-coverage]');
    const snapshotReportedTotal = dataSnapshot.reportedCommentTotal;
    coverage.classList.toggle('hidden', snapshotReportedTotal === undefined && !hasLoadingAttempt);
    if (snapshotReportedTotal === undefined) {
      coverage.classList.add('partial');
      coverage.textContent = hasLoadingAttempt
        ? `${dataSnapshot.verificationStatus === 'visible-complete' ? '⚠️ 可見留言已載完' : '尚未完成驗證'} · 已讀取 ${parsedTotal} 則 · Facebook 未提供可核對的總數`
        : '';
    } else {
      const countDifference = parsedTotal - snapshotReportedTotal;
      coverage.classList.toggle('partial', dataSnapshot.verificationStatus !== 'verified-complete');
      coverage.textContent = dataSnapshot.verificationStatus === 'verified-complete'
        ? `✅ 已驗證完整 · Facebook 顯示 ${snapshotReportedTotal} 則 · 已讀取 ${parsedTotal} 則`
        : countDifference < 0
          ? `⚠️ 可見留言已載完 · Facebook 顯示 ${snapshotReportedTotal} 則 · 已讀取 ${parsedTotal} 則 · 尚差 ${Math.abs(countDifference)} 則可能無法存取`
          : countDifference > 0
            ? `Facebook 顯示 ${snapshotReportedTotal} 則 · 已讀取 ${parsedTotal} 則 · 多出 ${countDifference} 則，請檢查重複或回覆分類`
            : `⚠️ Facebook 顯示 ${snapshotReportedTotal} 則 · 已讀取 ${parsedTotal} 則 · 數量一致，但載入流程尚未完成驗證`;
    }
    const missingDates = (filters.startDate || filters.endDate) ? snapshotParsed.comments.filter((comment) => !comment.createdAt).length : 0;
    query<HTMLElement>('[data-candidates]').textContent = `符合條件：${eligible.length} 個抽獎資格 · ${allAuthors.length} 位主留言者${duplicatePeople ? ` · ${duplicatePeople} 位重複留言` : ''}${snapshotParsed.postAuthor ? ` · 貼文作者：${snapshotParsed.postAuthor.name}` : ''}${missingDates ? ` · ${missingDates} 則無時間已排除` : ''}${missingProfiles ? ` · ${missingProfiles} 則缺個人頁連結，無法帳號去重` : ''}`;
    drawButton.disabled = eligible.length === 0;
    if (refreshComments) renderFullComments();
    if (message) status.textContent = message;
  }

  function renderFullComments(): void {
    const all = orderedComments(dataSnapshot.parsed);
    const term = query<HTMLInputElement>('[name="commentSearch"]').value.trim().toLocaleLowerCase();
    const visible = term ? all.filter((comment) => [comment.authorName, comment.body, comment.replyToAuthorName ?? '']
      .some((value) => value.toLocaleLowerCase().includes(term))) : all;
    query<HTMLElement>('[data-comment-count]').textContent = `${all.length} 則`;
    query<HTMLElement>('[data-comment-list-summary]').textContent = all.length
      ? `顯示 ${visible.length}／${all.length} 則；搜尋只影響畫面，不影響匯出或抽獎。`
      : '尚無留言資料';
    const list = query<HTMLElement>('[data-comment-list]');
    list.replaceChildren();
    visible.forEach((comment, index) => {
      const card = document.createElement('article');
      card.className = `comment-card ${comment.kind}`;
      const heading = document.createElement('div');
      heading.className = 'comment-heading';
      const kind = document.createElement('b');
      kind.textContent = comment.kind === 'reply' ? '回覆' : '主留言';
      const sequence = document.createElement('span');
      sequence.textContent = `#${comment.sequence ?? index + 1}`;
      heading.append(kind, sequence);
      const author = document.createElement('strong');
      author.textContent = comment.authorName;
      const body = document.createElement('p');
      body.textContent = comment.body || mediaLabel(comment) || '（無文字內容）';
      const meta = document.createElement('small');
      meta.textContent = [comment.replyToAuthorName ? `回覆 ${comment.replyToAuthorName}` : '', comment.createdAt ? formatLocalDate(comment.createdAt) : '', mediaLabel(comment)]
        .filter(Boolean).join(' · ');
      card.append(heading, author, body);
      if (meta.textContent) card.append(meta);
      if (comment.commentUrl) {
        const link = document.createElement('a');
        link.href = comment.commentUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = '開啟留言';
        card.append(link);
      }
      list.append(card);
    });
  }

  function scan(message = '掃描完成', mode: 'replace' | 'accumulate' = 'accumulate', root: ParentNode = document): number {
    const currentPage = pageKey();
    const pageChanged = currentPage !== activePage;
    if (pageChanged) {
      loadController?.abort();
      rawCommentStore.clear();
      activePage = currentPage;
      resetLoadingVerification();
      invalidateResult();
      mode = 'replace';
    }
    const locatedPostRoot = findFacebookPostRoot(document, activePage);
    const suppliedRootConnected = !(root instanceof Element) || root.isConnected;
    if (!suppliedRootConnected) mode = 'replace';
    const parseRoot = pageChanged || !suppliedRootConnected ? locatedPostRoot : root;
    const currentPostRoot = locatedPostRoot ?? parseRoot;
    reportedCommentTotal = currentPostRoot ? findReportedCommentTotal(currentPostRoot) : undefined;
    const current = parseRoot
      ? parseFacebookPost(parseRoot, activePage)
      : { comments: [], replies: [], diagnostics: ['目前找不到可辨識的貼文留言區。'] };
    const beforeDataset = storeFingerprint(rawCommentStore);
    const beforeAuthor = parsed.postAuthor?.url ?? parsed.postAuthor?.name;
    if (mode === 'replace') rawCommentStore.clear();
    const currentRecords = orderedComments(current);
    const currentEntries = snapshotEntries(currentRecords);
    const currentFingerprintCounts = new Map<string, number>();
    currentRecords.forEach((comment) => {
      const fingerprint = commentFingerprint(comment);
      currentFingerprintCounts.set(fingerprint, (currentFingerprintCounts.get(fingerprint) ?? 0) + 1);
    });
    const currentKeys = new Set<string>();
    currentEntries.forEach(([initialKey, comment], index) => {
      let key = initialKey;
      if (!rawCommentStore.has(key) && key.startsWith('rendered-node-') && currentFingerprintCounts.get(commentFingerprint(comment)) === 1) {
        const priorMatches = [...rawCommentStore].filter(([storedKey, stored]) => storedKey.startsWith('rendered-node-')
          && (commentFingerprint(stored) === commentFingerprint(comment) || sameRenderedRecord(stored, comment)));
        if (priorMatches.length === 1) {
          rawCommentStore.delete(priorMatches[0]![0]);
        }
      }
      currentKeys.add(key);
      rawCommentStore.set(key, { ...comment, sequence: index + 1 });
    });
    let nextSequence = currentEntries.length + 1;
    [...rawCommentStore]
      .filter(([key]) => !currentKeys.has(key))
      .sort(([, left], [, right]) => (left.sequence ?? 0) - (right.sequence ?? 0))
      .forEach(([key, comment]) => rawCommentStore.set(key, { ...comment, sequence: nextSequence++ }));
    const accumulated = [...rawCommentStore.values()];
    parsed = {
      ...current,
      comments: accumulated.filter((comment) => comment.kind === 'comment'),
      replies: accumulated.filter((comment) => comment.kind === 'reply'),
    };
    const afterDataset = storeFingerprint(rawCommentStore);
    const afterAuthor = parsed.postAuthor?.url ?? parsed.postAuthor?.name;
    if (lastSnapshot && (beforeDataset !== afterDataset || beforeAuthor !== afterAuthor)) invalidateResult();
    commitDataSnapshot(currentPostRoot);
    const diagnostic = current.diagnostics[0];
    refreshSummary(parsed.comments.length ? message : diagnostic ?? '目前找不到可辨識的留言。');
    errorCard.classList.toggle('hidden', parsed.comments.length > 0);
    query<HTMLElement>('[data-error-message]').textContent = diagnostic ?? 'Facebook 頁面結構可能已更新，或留言尚未載入。';
    return parsed.comments.length + parsed.replies.length;
  }

  async function startLoading(): Promise<void> {
    if (loadController) return;
    if (!ensureCurrentPage()) return;
    const loadingPage = activePage;
    const postRoot = findFacebookPostRoot(document, activePage);
    if (!postRoot) {
      status.textContent = '無法唯一定位目前貼文，請開啟貼文的獨立頁面後重試。';
      return;
    }
    loadController = new AbortController();
    hasLoadingAttempt = true;
    loadOutcome = '執行中';
    verificationStatus = 'partial';
    stablePasses = 0;
    loadHistory.length = 0;
    loadButton.classList.add('hidden');
    stopButton.classList.remove('hidden');
    try {
      const loadingResult = await loadMoreComments(
        postRoot,
        () => {
          const commentCount = scan('載入中', 'accumulate', postRoot);
          const records = orderedComments(parsed);
          return {
            commentCount,
            boundary: `${records[0]?.id ?? ''}\n${records.at(-1)?.id ?? ''}`,
            signature: storeFingerprint(rawCommentStore),
          };
        },
        (progress) => {
          status.textContent = `${progress.message}（第 ${progress.round} 輪）`;
          loadHistory.push({ ...progress });
          if (loadHistory.length > 80) loadHistory.shift();
        },
        loadController.signal,
      );
      const endReason = loadingResult.reason;
      stablePasses = loadingResult.stablePasses;
      if (pageKey() !== loadingPage || activePage !== loadingPage) {
        loadOutcome = '留言區已更新';
        const latestPageRoot = findFacebookPostRoot(document, pageKey());
        scan(loadOutcome, 'replace', latestPageRoot ?? document);
        loadOutcome = '留言區已更新';
        const committedRoot = findFacebookPostRoot(document, activePage);
        commitDataSnapshot(committedRoot);
        refreshSummary();
        status.textContent = '⚠️ 已切換到其他貼文，舊貼文載入已停止；請重新載入目前貼文';
        return;
      }
      const terminalOutcome = endReason === 'controls-remain' ? '尚有留言未展開'
        : endReason === 'limit-reached' ? '達到輪數上限'
          : endReason === 'root-lost' ? '留言區已更新'
            : endReason === 'aborted' ? '使用者停止' : '驗證載入結果中';
      loadOutcome = terminalOutcome;
      scan(loadOutcome, 'accumulate', postRoot);
      loadOutcome = terminalOutcome;
      const parsedTotal = parsed.comments.length + parsed.replies.length;
      const difference = reportedCommentTotal === undefined ? undefined : parsedTotal - reportedCommentTotal;
      const latestPostRoot = findFacebookPostRoot(document, activePage) ?? postRoot;
      const pendingControls = loadingResult.pendingControls || hasPendingExpansionControls(latestPostRoot);
      const verifiedComplete = endReason === 'complete' && difference === 0 && !pendingControls;
      const visibleComplete = endReason === 'complete' && stablePasses >= 2 && !pendingControls;
      verificationStatus = verifiedComplete ? 'verified-complete' : visibleComplete ? 'visible-complete' : 'partial';
      loadOutcome = verifiedComplete ? '載入完成'
        : visibleComplete ? '可見留言已載完'
        : endReason === 'root-lost' ? '留言區已更新'
          : endReason === 'aborted' ? '使用者停止'
            : endReason === 'limit-reached' ? '達到輪數上限'
              : endReason === 'controls-remain' || pendingControls ? '尚有留言未展開'
                : difference === undefined ? '無法驗證完整'
                  : difference !== 0 ? '載入未完整'
                    : loadOutcome;
      commitDataSnapshot(latestPostRoot);
      refreshSummary();
      status.textContent = verifiedComplete
        ? `✅ 已完成載入，共取得 ${parsed.comments.length} 則主留言、${parsed.replies.length} 則回覆，總計 ${parsedTotal} 則留言`
        : visibleComplete && difference !== undefined && difference < 0
          ? `⚠️ 可見留言已載完：${parsed.comments.length} 則主留言、${parsed.replies.length} 則回覆，共 ${parsedTotal} 則；Facebook 顯示仍多 ${Math.abs(difference)} 則可能無法存取`
          : visibleComplete && difference !== undefined && difference > 0
            ? `⚠️ 載入數量異常：已讀取 ${parsedTotal} 則，比 Facebook 顯示多 ${difference} 則；請檢查重複或回覆分類`
          : visibleComplete
            ? `⚠️ 可見留言已載完，共 ${parsedTotal} 則；Facebook 未提供可核對總數，匯出將標記為 partial`
        : endReason === 'root-lost' ? '⚠️ 留言區已更新，已改讀目前貼文，請再次載入全部留言'
          : endReason === 'aborted' ? '已停止載入'
            : endReason === 'limit-reached' ? '⚠️ 已達載入輪數上限，請再次載入'
              : pendingControls ? '⚠️ 頁面仍有留言或回覆尚未展開，請再次載入'
                : difference === undefined ? '⚠️ 已載入頁面可展開內容，但 Facebook 未提供總數，無法確認是否完整'
                  : difference < 0 ? `⚠️ 尚有 ${Math.abs(difference)} 則留言未載入或未展開`
                    : difference > 0 ? `⚠️ 已讀取數量比 Facebook 顯示多 ${difference} 則，請檢查資料`
                      : loadOutcome;
    } finally {
      loadController = undefined;
      loadButton.classList.remove('hidden');
      stopButton.classList.add('hidden');
    }
  }

  function renderPeople(container: HTMLElement, title: string, people: RaffleResult['winners']): void {
    container.replaceChildren();
    if (!people.length) return;
    const heading = document.createElement('h3');
    heading.textContent = title;
    container.append(heading);
    const list = document.createElement('ol');
    people.forEach((person) => {
      const item = document.createElement('li');
      const name = document.createElement(person.authorUrl ? 'a' : 'span');
      name.textContent = person.authorName;
      if (name instanceof HTMLAnchorElement && person.authorUrl) {
        name.href = person.authorUrl;
        name.target = '_blank';
        name.rel = 'noopener noreferrer';
      }
      const meta = document.createElement('small');
      meta.textContent = `符合留言 ${person.comments.length} 則`;
      item.append(name, meta);
      list.append(item);
    });
    container.append(list);
  }

  async function draw(): Promise<void> {
    if (!ensureCurrentPage()) return;
    const snapshotParsed = dataSnapshot.parsed;
    revalidateCompletedSnapshot();
    if (!confirmPartialUse('抽獎')) return;
    const winnerCount = clampNumber(query<HTMLInputElement>('[name="winnerCount"]').value, 1, 100);
    const alternateCount = clampNumber(query<HTMLInputElement>('[name="alternateCount"]').value, 0, 100);
    const filters = currentFilters();
    try {
      const result = drawRaffle(snapshotParsed.comments, snapshotParsed.postAuthor, filters, winnerCount, alternateCount);
      const proof = await createRaffleProof(result, filters, activePage);
      lastSnapshot = { result, proof, filters: { ...filters }, sourcePage: activePage, postAuthor: snapshotParsed.postAuthor };
      renderPeople(query('[data-winners]'), '正取', result.winners);
      renderPeople(query('[data-alternates]'), '備取', result.alternates);
      query<HTMLElement>('[data-results]').classList.remove('hidden');
      status.textContent = `已從 ${result.participants.length} 個抽獎資格中完成抽獎。`;
      query<HTMLElement>('[data-results]').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '抽獎失敗，請重新掃描。';
    }
  }

  function invalidateResult(): void {
    lastSnapshot = undefined;
    query<HTMLElement>('[data-results]').classList.add('hidden');
  }

  function ensureCurrentPage(): boolean {
    if (pageKey() === activePage) return true;
    scan('偵測到已切換貼文，名單已重設', 'replace');
    return false;
  }

  async function copyDiagnostic(): Promise<void> {
    const labelNodes = [...document.querySelectorAll<HTMLElement>('[aria-label*="留言"], [aria-label*="回覆"], [aria-label*="Comment"], [aria-label*="Reply"]')];
    const labelPatterns = [...new Set(labelNodes.map((node) => `${node.tagName.toLowerCase()}[role=${node.getAttribute('role') ?? '-'}] ${safeLabelPattern(node.getAttribute('aria-label') ?? '')}`))].slice(0, 12);
    const roleLinkNodes = [...document.querySelectorAll<HTMLElement>('[role="link"]')];
    const scrollContainers = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((node) => node.scrollHeight > node.clientHeight + 80)
      .slice(0, 20)
      .map((node) => ({ tag: node.tagName.toLowerCase(), role: node.getAttribute('role') ?? '-', clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: Math.round(node.scrollTop), overflowY: getComputedStyle(node).overflowY, commentSignals: node.querySelectorAll('[aria-label*="留言"], [aria-label*="回覆"], [aria-label*="Comment"], [aria-label*="Reply"]').length }));
    const commentControls = labelNodes.filter((node) => node.matches('button, [role="button"]')).slice(0, 30).map((node) => {
      const rect = node.getBoundingClientRect();
      return { pattern: safeLabelPattern(node.getAttribute('aria-label') ?? node.textContent ?? ''), visible: rect.width > 0 && rect.height > 0, top: Math.round(rect.top), height: Math.round(rect.height), expanded: node.getAttribute('aria-expanded') ?? '-', disabled: node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true' };
    });
    const mobileRowGeometry = labelNodes
      .filter((node) => node.matches('button, [role="button"]') && /^留言.+按.+按/u.test((node.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim()))
      .slice(0, 60)
      .map((node) => {
        const row = node.parentElement;
        const textRects = row ? [...row.querySelectorAll<HTMLElement>('[dir="auto"]')]
          .filter((item) => !item.querySelector('[dir="auto"]')).slice(0, 3)
          .map((item) => { const rect = item.getBoundingClientRect(); return { left: Math.round(rect.left), width: Math.round(rect.width) }; }) : [];
        const rect = node.getBoundingClientRect();
        return { actionLeft: Math.round(rect.left), actionWidth: Math.round(rect.width), textRects };
      });
    const snapshotParsed = dataSnapshot.parsed;
    const detectedTotal = dataSnapshot.reportedCommentTotal;
    const parsedTotal = snapshotParsed.comments.length + snapshotParsed.replies.length;
    const reportedGap = detectedTotal ? Math.max(0, detectedTotal - parsedTotal) : 0;
    const reportedDifference = detectedTotal === undefined ? null : parsedTotal - detectedTotal;
    const details = {
      diagnosticVersion: 5,
      toolVersion: TOOL_VERSION,
      code: !snapshotParsed.comments.length
        ? 'POST_NOT_FOUND'
        : dataSnapshot.verificationStatus === 'verified-complete' && !dataSnapshot.pendingExpansionControls && reportedDifference === 0 ? 'LOAD_COMPLETE'
          : dataSnapshot.verificationStatus === 'visible-complete' ? 'LOAD_VISIBLE_COMPLETE'
          : dataSnapshot.loadOutcome === '無法驗證完整' ? 'LOAD_UNVERIFIED'
            : dataSnapshot.loadOutcome === '使用者停止' ? 'LOAD_STOPPED'
              : dataSnapshot.loadOutcome === '達到輪數上限' ? 'LOAD_LIMIT_REACHED'
                : dataSnapshot.loadOutcome === '留言區已更新' ? 'LOAD_ROOT_LOST'
                  : dataSnapshot.loadOutcome === '執行中' ? 'LOAD_RUNNING'
                    : hasLoadingAttempt ? 'LOAD_PARTIAL'
                      : 'LOAD_NOT_ATTEMPTED',
      message: snapshotParsed.diagnostics[0] ?? '',
      snapshotId: dataSnapshot.id,
      snapshotCapturedAt: dataSnapshot.capturedAt,
      parsedComments: snapshotParsed.comments.length,
      parsedReplies: snapshotParsed.replies.length,
      parsedTotal,
      reportedCommentTotal: detectedTotal ?? null,
      reportedGap,
      reportedDifference,
      loadingAttempted: hasLoadingAttempt,
      pendingExpansionControls: dataSnapshot.pendingExpansionControls,
      verificationStatus: dataSnapshot.verificationStatus,
      stablePasses: dataSnapshot.stablePasses,
      loadOutcome: dataSnapshot.loadOutcome,
      loadHistory,
      windowScroll: { x: Math.round(scrollX), y: Math.round(scrollY), innerHeight, documentHeight: document.documentElement.scrollHeight, bodyHeight: document.body?.scrollHeight ?? 0 },
      scrollContainers,
      commentControls,
      mobileRowGeometry,
      articles: document.querySelectorAll('article').length,
      roleArticles: document.querySelectorAll('[role="article"]').length,
      anchors: document.querySelectorAll('a').length,
      hrefAnchors: document.querySelectorAll('a[href]').length,
      roleLinks: roleLinkNodes.length,
      roleLinkPatterns: [...new Set(roleLinkNodes.slice(0, 20).map((node) => `${node.tagName.toLowerCase()} ${safeLabelPattern(node.getAttribute('aria-label') ?? '') || `text-length:${(node.textContent ?? '').trim().length}`}`))].slice(0, 10),
      dirAutoElements: document.querySelectorAll('[dir="auto"]').length,
      labeledComments: labelNodes.length, labelPatterns,
      ancestorTraces: labelNodes.slice(0, 6).map((node) => ({ signal: `${node.tagName.toLowerCase()}[role=${node.getAttribute('role') ?? '-'}] ${safeLabelPattern(node.getAttribute('aria-label') ?? '')}`, ancestors: safeAncestorTrace(node) })),
      roleCounts: roleCounts(),
      mainElements: document.querySelectorAll('main, [role="main"]').length,
      language: document.documentElement.lang || 'unknown', browser: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}`,
    };
    const states = shadow.querySelectorAll<HTMLElement>('[data-load-copy-state]');
    try { await navigator.clipboard.writeText(JSON.stringify(details, null, 2)); states.forEach((state) => { state.textContent = '已複製'; }); }
    catch { states.forEach((state) => { state.textContent = '複製失敗，請截圖錯誤代碼'; }); }
  }

  function fullCommentDataset(): FullCommentExport {
    const snapshotParsed = dataSnapshot.parsed;
    const comments = orderedComments(snapshotParsed);
    const countsMatch = dataSnapshot.reportedCommentTotal !== undefined && dataSnapshot.reportedCommentTotal === comments.length;
    return {
      toolVersion: TOOL_VERSION,
      exportedAt: new Date().toISOString(),
      snapshotId: dataSnapshot.id,
      snapshotCapturedAt: dataSnapshot.capturedAt,
      sourcePage: activePage,
      ...(snapshotParsed.postAuthor ? { postAuthor: snapshotParsed.postAuthor } : {}),
      load: {
        outcome: dataSnapshot.loadOutcome,
        ...(dataSnapshot.reportedCommentTotal !== undefined ? { reportedCommentTotal: dataSnapshot.reportedCommentTotal } : {}),
        mainComments: snapshotParsed.comments.length,
        replies: snapshotParsed.replies.length,
        total: comments.length,
        pendingExpansionControls: dataSnapshot.pendingExpansionControls,
        complete: dataSnapshot.verificationStatus === 'verified-complete' && countsMatch && !dataSnapshot.pendingExpansionControls,
        verificationStatus: dataSnapshot.verificationStatus,
        reportedGap: Math.max(0, (dataSnapshot.reportedCommentTotal ?? comments.length) - comments.length),
        stablePasses: dataSnapshot.stablePasses,
      },
      comments,
    };
  }

  function ensureCommentData(): FacebookComment[] | undefined {
    if (!ensureCurrentPage()) return undefined;
    revalidateCompletedSnapshot();
    const comments = orderedComments(dataSnapshot.parsed);
    if (!comments.length) status.textContent = '目前沒有可查看或匯出的留言資料。';
    return comments.length ? comments : undefined;
  }

  function exportMetadata() {
    const comments = orderedComments(dataSnapshot.parsed);
    return {
      snapshotId: dataSnapshot.id,
      verificationStatus: dataSnapshot.verificationStatus,
      ...(dataSnapshot.reportedCommentTotal !== undefined ? { reportedCommentTotal: dataSnapshot.reportedCommentTotal } : {}),
      parsedTotal: comments.length,
    };
  }

  function confirmPartialUse(action: '複製' | '下載' | '抽獎'): boolean {
    if (dataSnapshot.verificationStatus === 'verified-complete') return true;
    const total = dataSnapshot.parsed.comments.length + dataSnapshot.parsed.replies.length;
    const gap = dataSnapshot.reportedCommentTotal === undefined ? undefined : Math.max(0, dataSnapshot.reportedCommentTotal - total);
    return confirm(`目前是部分資料：已讀取 ${total} 則${gap ? `，Facebook 顯示仍多 ${gap} 則可能無法存取` : ''}。檔案會標記為 partial，仍要${action}嗎？`);
  }

  async function copyAllComments(): Promise<void> {
    const comments = ensureCommentData();
    if (!comments || !confirmPartialUse('複製')) return;
    const state = query<HTMLElement>('[data-comment-copy-state]');
    try {
      await copyText(commentsToText(comments, exportMetadata()));
      state.textContent = `已複製 ${comments.length} 則完整留言。`;
    } catch {
      state.textContent = '複製失敗，請改用下載 CSV、TXT 或 JSON。';
    }
  }

  const handlePageNavigation = (): void => {
    if (typeof location === 'undefined' || !host.isConnected) {
      pageObserver.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('popstate', handlePageNavigation);
      return;
    }
    if (loadController || pageKey() === activePage) return;
    scan('偵測到已切換貼文，留言資料已更新', 'replace');
  };
  const pageObserver = new MutationObserver(handlePageNavigation);
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', handlePageNavigation);

  const rulesChanged = (event: Event) => {
    if ((event.target as HTMLInputElement).name === 'commentSearch') { renderFullComments(); return; }
    invalidateResult();
    refreshSummary('抽獎條件已變更，請重新抽獎。', false);
  };
  shadow.addEventListener('input', rulesChanged);
  shadow.addEventListener('change', rulesChanged);
  shadow.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'close') {
      loadController?.abort();
      pageObserver.disconnect();
      window.removeEventListener('popstate', handlePageNavigation);
      host.remove();
    }
    if (action === 'collapse') host.toggleAttribute('data-collapsed');
    if (action === 'scan') { resetLoadingVerification(); scan('掃描完成', 'replace'); }
    if (action === 'load') void startLoading();
    if (action === 'stop') loadController?.abort();
    if (action === 'draw') void draw();
    if (action === 'copy-diagnostic') void copyDiagnostic();
    if (action === 'copy-load-diagnostic') void copyDiagnostic();
    if (action === 'copy-comments') void copyAllComments();
    if (action === 'export-csv') {
      const comments = ensureCommentData();
      if (comments && confirmPartialUse('下載')) {
        const partial = dataSnapshot.verificationStatus !== 'verified-complete';
        downloadText(partial ? 'facebook-comments-partial.csv' : 'facebook-comments.csv', commentsToCsv(comments, exportMetadata()), 'text/csv;charset=utf-8');
        query<HTMLElement>('[data-comment-copy-state]').textContent = `已下載 ${comments.length} 則 CSV（資料快照 #${dataSnapshot.id}）。`;
      }
    }
    if (action === 'export-txt') {
      const comments = ensureCommentData();
      if (comments && confirmPartialUse('下載')) {
        const partial = dataSnapshot.verificationStatus !== 'verified-complete';
        downloadText(partial ? 'facebook-comments-partial.txt' : 'facebook-comments.txt', commentsToText(comments, exportMetadata()), 'text/plain;charset=utf-8');
        query<HTMLElement>('[data-comment-copy-state]').textContent = `已下載 ${comments.length} 則 TXT（資料快照 #${dataSnapshot.id}）。`;
      }
    }
    if (action === 'export-json') {
      const comments = ensureCommentData();
      if (comments && confirmPartialUse('下載')) {
        const partial = dataSnapshot.verificationStatus !== 'verified-complete';
        downloadJson(partial ? 'facebook-comments-partial.json' : 'facebook-comments.json', fullCommentDataset());
        query<HTMLElement>('[data-comment-copy-state]').textContent = `已下載 ${comments.length} 則 JSON（資料快照 #${dataSnapshot.id}）。`;
      }
    }
    if (action === 'proof' && lastSnapshot && ensureCurrentPage()) downloadJson('fb-giveaway-record.json', lastSnapshot.proof);
    if (action === 'full-export' && lastSnapshot && ensureCurrentPage() && confirm('完整名單包含姓名、留言與個人頁連結。確定要下載到這台裝置嗎？')) {
      downloadJson('fb-giveaway-full-list.json', {
        exportedAt: new Date().toISOString(),
        sourcePage: lastSnapshot.sourcePage,
        postAuthor: lastSnapshot.postAuthor,
        filters: lastSnapshot.filters,
        participants: lastSnapshot.result.participants,
        winners: lastSnapshot.result.winners,
        alternates: lastSnapshot.result.alternates,
      });
    }
  });

  host.addEventListener('fb-giveaway:activate', () => { resetLoadingVerification(); scan('已重新檢查目前貼文', 'replace'); });

  scan('掃描完成', 'replace');
}

function pageKey(): string {
  const url = new URL(location.href);
  url.hash = '';
  return url.href;
}

function snapshotEntries(comments: FacebookComment[]): Array<[string, FacebookComment]> {
  const occurrences = new Map<string, number>();
  return comments.map((comment) => {
    if (!comment.id.startsWith('rendered-') || comment.id.startsWith('rendered-node-')) return [comment.id, comment];
    const fingerprint = commentFingerprint(comment);
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return [`rendered:${fingerprint}\n#${occurrence}`, comment];
  });
}

function commentFingerprint(comment: FacebookComment): string {
  return `${comment.kind}\n${comment.authorUrl ?? comment.authorName}\n${comment.body}\n${comment.createdAt ?? ''}\n${comment.replyToAuthorName ?? ''}\n${mediaLabel(comment)}`;
}

function sameRenderedRecord(previous: FacebookComment, current: FacebookComment): boolean {
  if (previous.kind !== current.kind
    || (previous.authorUrl ?? previous.authorName) !== (current.authorUrl ?? current.authorName)
    || (previous.createdAt ?? '') !== (current.createdAt ?? '')
    || (previous.replyToAuthorName ?? '') !== (current.replyToAuthorName ?? '')) return false;
  const left = normalizedBodyPrefix(previous.body);
  const right = normalizedBodyPrefix(current.body);
  return Boolean(left && right && (left.startsWith(right) || right.startsWith(left)));
}

function normalizedBodyPrefix(value: string): string {
  return value.replace(/(?:…|\.\.\.|查看更多)\s*$/u, '').trim();
}

function storeFingerprint(store: Map<string, FacebookComment>): string {
  return [...store].map(([key, comment]) => `${key}\n${comment.kind}\n${comment.authorUrl ?? comment.authorName}\n${comment.body}\n${comment.createdAt ?? ''}\n${comment.replyToAuthorName ?? ''}`).join('\n---\n');
}

function cloneParsedPost(value: ParsedFacebookPost): ParsedFacebookPost {
  const cloneComment = (comment: FacebookComment): FacebookComment => ({
    ...comment,
    ...(comment.media ? { media: comment.media.map((media) => ({ ...media })) } : {}),
  });
  return {
    ...(value.postAuthor ? { postAuthor: { ...value.postAuthor } } : {}),
    comments: value.comments.map(cloneComment),
    replies: value.replies.map(cloneComment),
    diagnostics: [...value.diagnostics],
  };
}

function safeLabelPattern(value: string): string {
  return value.replace(/[^\s留言回覆按讚的這則查看更多，。:：()（）[\]\-]/gu, '•').replace(/•+/g, '•').slice(0, 120);
}

function safeAncestorTrace(start: Element): string[] {
  const trace: string[] = [];
  let node: Element | null = start;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    const dataNames = node.getAttributeNames().filter((name) => name.startsWith('data-')).slice(0, 5).join(',') || '-';
    trace.push(`${node.tagName.toLowerCase()}[role=${node.getAttribute('role') ?? '-'}] links=${node.querySelectorAll('a[href],[role="link"]').length} auto=${node.querySelectorAll('[dir="auto"]').length} spans=${node.querySelectorAll('span').length} buttons=${node.querySelectorAll('[role="button"],button').length} data=${dataNames}`);
  }
  return trace;
}

function roleCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  document.querySelectorAll<HTMLElement>('[role]').forEach((node) => {
    const role = node.getAttribute('role') ?? 'unknown';
    counts[role] = (counts[role] ?? 0) + 1;
  });
  return counts;
}

function findReportedCommentTotal(root: ParentNode): number | undefined {
  const labeledTotals = [...root.querySelectorAll<HTMLElement>('[aria-label]')]
    .flatMap((node) => {
      const label = (node.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
      const embedded = label.match(/(\d[\d,.]*)\s*則?留言(?:，|。|$)/u)?.[1];
      const actionCount = /^(?:留言|comments?)$/iu.test(label)
        ? (node.textContent ?? '').replace(/\s+/g, '').match(/^\d[\d,.]*$/)?.[0]
        : undefined;
      return [embedded, actionCount].filter((value): value is string => Boolean(value));
    });
  const totals = labeledTotals
    .filter((value): value is string => Boolean(value))
    .map((value) => Number.parseInt(value.replace(/[,.]/g, ''), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  return totals.length ? Math.max(...totals) : undefined;
}

function clampNumber(value: string, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : minimum));
}

function downloadJson(filename: string, value: unknown): void {
  downloadText(filename, JSON.stringify(value, null, 2), 'application/json;charset=utf-8');
}

function downloadText(filename: string, value: string, mimeType: string): void {
  const blob = new Blob([value], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Copy failed');
}

function panelStyles(): string { return `<style>
:host{all:initial;position:fixed;z-index:2147483647;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#19201e}
:host([data-hidden]){display:none}:host([data-collapsed]) .body{display:none}:host([data-collapsed]) .panel{width:auto}.panel{width:min(410px,calc(100vw - 20px));max-height:min(760px,calc(100dvh - 20px));display:flex;flex-direction:column;background:#f7f6f0;border:1px solid rgba(0,0,0,.14);border-radius:20px;box-shadow:0 20px 80px rgba(0,0,0,.3);overflow:hidden}.header{display:flex;justify-content:space-between;align-items:flex-start;padding:17px 18px;background:#174f3f;color:white}.header h1{font:750 20px/1.15 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:5px 0 0}.badge{font:700 10px/1 sans-serif;letter-spacing:.1em;color:#d7f36b}.header-actions{display:flex;gap:7px}.icon{width:34px;height:34px;border:1px solid rgba(255,255,255,.25);border-radius:10px;background:transparent;color:white;font-size:21px;line-height:1;cursor:pointer}.body{overflow:auto;overscroll-behavior:contain;padding:14px 14px 18px}.notice{display:flex;flex-direction:column;gap:4px;background:#ece8d8;border-radius:12px;padding:11px 12px;font:13px/1.4 sans-serif}.notice span{color:#69716d}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin:12px 0}.stats div{background:white;border:1px solid rgba(0,0,0,.09);border-radius:12px;padding:10px;text-align:center}.stats strong{display:block;font-size:22px;color:#174f3f}.stats span{font-size:11px;color:#69716d}.coverage{margin:-4px 0 12px;padding:8px 10px;border-radius:9px;background:#e7f2ed;color:#174f3f;font:700 11px/1.4 sans-serif}.coverage.partial{background:#fff0d8;color:#7a4b00}.load-row{display:flex;gap:7px}.button{min-height:42px;border-radius:11px;padding:0 12px;border:0;font-weight:700;font-size:13px;cursor:pointer}.primary{background:#174f3f;color:white;flex:1}.secondary{background:white;color:#174f3f;border:1px solid rgba(23,79,63,.25)}.danger{background:#9d3028;color:white;flex:1}.ghost{background:transparent;color:#43504a;text-decoration:underline}.hidden{display:none!important}.status{margin:10px 2px 13px;color:#59625e;font-size:12px;line-height:1.4}details{background:white;border:1px solid rgba(0,0,0,.09);border-radius:14px;padding:12px}summary{font-weight:750;font-size:14px;cursor:pointer}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.form-grid label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#616b66}.form-grid .full{grid-column:1/-1}.form-grid input[type=text],.form-grid input[type=date],.form-grid input[type=number]{width:100%;height:39px;border:1px solid #ced2ce;border-radius:9px;background:#fbfbf8;color:#19201e;padding:0 10px;font:14px sans-serif}.check{flex-direction:row!important;align-items:center;font-size:13px!important;color:#303835!important}.check input{width:18px;height:18px;accent-color:#174f3f}.candidate-summary{margin:12px 0 0;padding-top:10px;border-top:1px solid #e5e5df;font-size:12px;color:#174f3f;font-weight:700}.draw{width:100%;min-height:52px;margin-top:12px;border:0;border-radius:13px;background:#d7f36b;color:#174f3f;font-size:17px;font-weight:800;cursor:pointer}.draw:disabled{background:#dfe1da;color:#90958f;cursor:not-allowed}.results{margin-top:14px;padding:14px;background:#174f3f;color:white;border-radius:14px}.results h2{margin:0 0 12px;font-size:18px}.results h3{margin:12px 0 6px;font-size:12px;color:#d7f36b;letter-spacing:.08em}.results ol{margin:0;padding-left:25px}.results li{padding:7px 0;border-bottom:1px solid rgba(255,255,255,.14)}.results a,.results li>span{display:block;color:white;font-weight:750;font-size:15px}.results small{color:rgba(255,255,255,.65);font-size:11px}.export-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.export-row .secondary{border:0}.results .ghost{color:white}.footer-note{margin:13px 4px 0;color:#777e7a;font-size:10px;line-height:1.45}
.diagnostic-row{display:flex;align-items:center;gap:8px;margin:-5px 2px 10px}.diagnostic-link{border:0;background:transparent;color:#174f3f;padding:3px 0;text-decoration:underline;font:700 11px sans-serif}.diagnostic-row span{font-size:10px;color:#59625e}.bottom-diagnostic{display:flex;align-items:center;gap:8px;margin-top:12px}.bottom-diagnostic button{min-height:44px}.bottom-diagnostic span{font-size:10px;color:#59625e}.error-card{margin:0 0 13px;padding:13px;background:#fff0ee;border:1px solid #e4a19b;border-left:4px solid #b9382e;border-radius:12px;color:#67221d}.error-card strong{display:block;font-size:14px}.error-card p{margin:6px 0 9px;font-size:12px;line-height:1.45}.error-card code{display:inline-block;padding:4px 7px;border-radius:6px;background:#f5d6d2;color:#852b24;font:700 11px ui-monospace,monospace}.error-card div{display:flex;align-items:center;gap:8px;margin-top:10px}.error-button{min-height:36px;background:#b9382e;color:white}.error-card span{font-size:10px;color:#852b24}.form-grid input{box-sizing:border-box;min-width:0}
details{margin-top:10px}summary span{float:right;color:#69716d;font-size:11px}.comment-search{display:flex;flex-direction:column;gap:5px;margin-top:12px;color:#616b66;font-size:11px}.comment-search input{box-sizing:border-box;width:100%;height:39px;border:1px solid #ced2ce;border-radius:9px;background:#fbfbf8;color:#19201e;padding:0 10px;font:14px sans-serif}.comment-list-summary{margin:9px 0;color:#69716d;font-size:10px}.comment-list{display:flex;flex-direction:column;gap:7px;max-height:310px;overflow:auto;overscroll-behavior:contain}.comment-card{padding:9px;border:1px solid #e3e5e1;border-radius:10px;background:#fbfbf8}.comment-card.reply{margin-left:18px;border-left:3px solid #8aafa2}.comment-heading{display:flex;justify-content:space-between;color:#174f3f;font-size:10px}.comment-card strong{display:block;margin-top:4px;font-size:12px}.comment-card p{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.45}.comment-card small{display:block;color:#69716d;font-size:10px}.comment-card a{display:inline-block;margin-top:5px;color:#174f3f;font-size:10px}.raw-export-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:10px}.raw-export-row .primary{grid-column:1/-1}.copy-state{margin:7px 0 0;color:#174f3f;font-size:10px}.advanced{padding:10px;background:#f2f1eb}
.section-title{margin:13px 2px -4px;font-size:13px;color:#174f3f}
@media(max-width:520px){:host{left:10px;right:10px}.panel{width:100%;max-height:calc(100dvh - 20px)}.form-grid{gap:8px}.body{padding:12px}}
</style>`; }
