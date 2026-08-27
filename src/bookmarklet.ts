import { loadMoreComments } from './loader';
import { findFacebookPostRoot, parseFacebookPost } from './parser';
import { createRaffleProof, drawRaffle, filterComments, participantsFrom } from './raffle';
import type { FacebookComment, ParsedFacebookPost, RaffleFilters, RaffleProof, RaffleResult } from './types';

const ROOT_ID = 'fb-comment-giveaway-bookmarklet';
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
      <div><span class="badge">本機執行</span><h1>FB 留言抽獎</h1></div>
      <div class="header-actions"><button class="icon" data-action="collapse" aria-label="收合面板">−</button><button class="icon" data-action="close" aria-label="關閉面板">×</button></div>
    </header>
    <div class="body">
      <section class="notice"><b>先把留言排序切成「所有留言」</b><span>工具只會讀取這個頁面已載入的內容。</span></section>
      <section class="stats" aria-live="polite">
        <div><strong data-stat="comments">0</strong><span>主留言</span></div>
        <div><strong data-stat="participants">0</strong><span>參加者</span></div>
        <div><strong data-stat="duplicates">0</strong><span>重複留言者</span></div>
      </section>
      <section class="load-row">
        <button class="button secondary" data-action="scan">重新掃描</button>
        <button class="button primary" data-action="load">繼續載入留言</button>
        <button class="button danger hidden" data-action="stop">停止</button>
      </section>
      <p class="status" data-status aria-live="polite">準備掃描目前頁面…</p>
      <section class="error-card hidden" data-error role="alert">
        <strong>找不到 Facebook 留言</strong><p data-error-message></p><code>錯誤代碼：POST_NOT_FOUND</code>
        <div><button class="button error-button" data-action="copy-diagnostic">複製診斷資訊</button><span data-copy-state></span></div>
      </section>
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
      <p class="footer-note">不讀取 Cookie、密碼或 Access Token。關閉或重新整理頁面後，本次資料即消失。</p>
    </div>
  </aside>`;
  document.documentElement.append(host);

  let parsed: ParsedFacebookPost = { comments: [], replies: [], diagnostics: [] };
  let activePage = pageKey();
  const commentStore = new Map<string, ParsedFacebookPost['comments'][number]>();
  let lastSnapshot: { result: RaffleResult; proof: RaffleProof; filters: RaffleFilters; sourcePage: string; postAuthor: ParsedFacebookPost['postAuthor'] } | undefined;
  let loadController: AbortController | undefined;

  const query = <T extends Element>(selector: string) => shadow.querySelector<T>(selector)!;
  const status = query<HTMLElement>('[data-status]');
  const drawButton = query<HTMLButtonElement>('[data-action="draw"]');
  const loadButton = query<HTMLButtonElement>('[data-action="load"]');
  const stopButton = query<HTMLButtonElement>('[data-action="stop"]');
  const errorCard = query<HTMLElement>('[data-error]');

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

  function refreshSummary(message?: string): void {
    const filters = currentFilters();
    const filtered = filterComments(parsed.comments, parsed.postAuthor, filters);
    const eligible = participantsFrom(filtered, filters.oneEntryPerPerson !== false);
    const allAuthors = participantsFrom(parsed.comments, true);
    const duplicatePeople = allAuthors.filter((person) => person.comments.length > 1).length;
    const missingProfiles = parsed.comments.filter((comment) => !comment.authorUrl).length;
    query<HTMLElement>('[data-stat="comments"]').textContent = String(parsed.comments.length);
    query<HTMLElement>('[data-stat="participants"]').textContent = String(allAuthors.length);
    query<HTMLElement>('[data-stat="duplicates"]').textContent = String(duplicatePeople);
    const missingDates = (filters.startDate || filters.endDate) ? parsed.comments.filter((comment) => !comment.createdAt).length : 0;
    query<HTMLElement>('[data-candidates]').textContent = `符合條件：${eligible.length} 個抽獎資格${parsed.postAuthor ? ` · 貼文作者：${parsed.postAuthor.name}` : ''}${missingDates ? ` · ${missingDates} 則無時間已排除` : ''}${missingProfiles ? ` · ${missingProfiles} 則缺個人頁連結，無法帳號去重` : ''}`;
    drawButton.disabled = eligible.length === 0;
    if (message) status.textContent = message;
  }

  function scan(message = '掃描完成', mode: 'replace' | 'accumulate' = 'accumulate', root: ParentNode = document): number {
    const currentPage = pageKey();
    if (currentPage !== activePage) {
      loadController?.abort();
      commentStore.clear();
      activePage = currentPage;
      invalidateResult();
      mode = 'replace';
    }
    const current = parseFacebookPost(root, activePage);
    const beforeDataset = storeFingerprint(commentStore);
    const beforeAuthor = parsed.postAuthor?.url ?? parsed.postAuthor?.name;
    if (mode === 'replace') commentStore.clear();
    snapshotEntries(current.comments).forEach(([key, comment]) => commentStore.set(key, comment));
    parsed = { ...current, comments: [...commentStore.values()] };
    const afterDataset = storeFingerprint(commentStore);
    const afterAuthor = parsed.postAuthor?.url ?? parsed.postAuthor?.name;
    if (lastSnapshot && (beforeDataset !== afterDataset || beforeAuthor !== afterAuthor)) invalidateResult();
    const diagnostic = current.diagnostics[0];
    refreshSummary(parsed.comments.length ? `${message}，已辨識 ${parsed.comments.length} 則主留言。` : diagnostic ?? '目前找不到可辨識的留言。');
    errorCard.classList.toggle('hidden', parsed.comments.length > 0);
    query<HTMLElement>('[data-error-message]').textContent = diagnostic ?? 'Facebook 頁面結構可能已更新，或留言尚未載入。';
    return parsed.comments.length;
  }

  async function startLoading(): Promise<void> {
    if (loadController) return;
    if (!ensureCurrentPage()) return;
    const postRoot = findFacebookPostRoot(document, activePage);
    if (!postRoot) {
      status.textContent = '無法唯一定位目前貼文，請開啟貼文的獨立頁面後重試。';
      return;
    }
    loadController = new AbortController();
    loadButton.classList.add('hidden');
    stopButton.classList.remove('hidden');
    try {
      await loadMoreComments(
        postRoot,
        () => scan('載入中', 'accumulate', postRoot),
        (progress) => { status.textContent = `${progress.message}（第 ${progress.round} 輪）`; },
        loadController.signal,
      );
      scan(loadController.signal.aborted ? '已停止載入' : '載入結束');
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
    const winnerCount = clampNumber(query<HTMLInputElement>('[name="winnerCount"]').value, 1, 100);
    const alternateCount = clampNumber(query<HTMLInputElement>('[name="alternateCount"]').value, 0, 100);
    const filters = currentFilters();
    try {
      const result = drawRaffle(parsed.comments, parsed.postAuthor, filters, winnerCount, alternateCount);
      const proof = await createRaffleProof(result, filters, activePage);
      lastSnapshot = { result, proof, filters: { ...filters }, sourcePage: activePage, postAuthor: parsed.postAuthor };
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
    const details = { code: 'POST_NOT_FOUND', message: parsed.diagnostics[0] ?? '', articles: document.querySelectorAll('article').length, roleArticles: document.querySelectorAll('[role="article"]').length, labeledComments: document.querySelectorAll('[aria-label*="留言"], [aria-label*="回覆"], [aria-label*="Comment"], [aria-label*="Reply"]').length, mainElements: document.querySelectorAll('main, [role="main"]').length, language: document.documentElement.lang || 'unknown', browser: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}` };
    const state = query<HTMLElement>('[data-copy-state]');
    try { await navigator.clipboard.writeText(JSON.stringify(details, null, 2)); state.textContent = '已複製'; }
    catch { state.textContent = '複製失敗，請截圖錯誤代碼'; }
  }

  const rulesChanged = () => { invalidateResult(); refreshSummary('抽獎條件已變更，請重新抽獎。'); };
  shadow.addEventListener('input', rulesChanged);
  shadow.addEventListener('change', rulesChanged);
  shadow.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'close') { loadController?.abort(); host.remove(); }
    if (action === 'collapse') host.toggleAttribute('data-collapsed');
    if (action === 'scan') scan('掃描完成', 'replace');
    if (action === 'load') void startLoading();
    if (action === 'stop') loadController?.abort();
    if (action === 'draw') void draw();
    if (action === 'copy-diagnostic') void copyDiagnostic();
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

  host.addEventListener('fb-giveaway:activate', () => scan('已重新檢查目前貼文', 'replace'));

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
    if (!comment.id.startsWith('rendered-')) return [comment.id, comment];
    const fingerprint = `${comment.authorUrl ?? comment.authorName}\n${comment.body}\n${comment.createdAt ?? ''}`;
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return [`rendered:${fingerprint}\n#${occurrence}`, comment];
  });
}

function storeFingerprint(store: Map<string, FacebookComment>): string {
  return [...store].map(([key, comment]) => `${key}\n${comment.authorUrl ?? comment.authorName}\n${comment.body}\n${comment.createdAt ?? ''}`).join('\n---\n');
}

function clampNumber(value: string, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : minimum));
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
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

function panelStyles(): string { return `<style>
:host{all:initial;position:fixed;z-index:2147483647;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#19201e}
:host([data-hidden]){display:none}:host([data-collapsed]) .body{display:none}:host([data-collapsed]) .panel{width:auto}.panel{width:min(410px,calc(100vw - 20px));max-height:min(760px,calc(100dvh - 20px));display:flex;flex-direction:column;background:#f7f6f0;border:1px solid rgba(0,0,0,.14);border-radius:20px;box-shadow:0 20px 80px rgba(0,0,0,.3);overflow:hidden}.header{display:flex;justify-content:space-between;align-items:flex-start;padding:17px 18px;background:#174f3f;color:white}.header h1{font:750 20px/1.15 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:5px 0 0}.badge{font:700 10px/1 sans-serif;letter-spacing:.1em;color:#d7f36b}.header-actions{display:flex;gap:7px}.icon{width:34px;height:34px;border:1px solid rgba(255,255,255,.25);border-radius:10px;background:transparent;color:white;font-size:21px;line-height:1;cursor:pointer}.body{overflow:auto;overscroll-behavior:contain;padding:14px 14px 18px}.notice{display:flex;flex-direction:column;gap:4px;background:#ece8d8;border-radius:12px;padding:11px 12px;font:13px/1.4 sans-serif}.notice span{color:#69716d}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:12px 0}.stats div{background:white;border:1px solid rgba(0,0,0,.09);border-radius:12px;padding:10px;text-align:center}.stats strong{display:block;font-size:22px;color:#174f3f}.stats span{font-size:11px;color:#69716d}.load-row{display:flex;gap:7px}.button{min-height:42px;border-radius:11px;padding:0 12px;border:0;font-weight:700;font-size:13px;cursor:pointer}.primary{background:#174f3f;color:white;flex:1}.secondary{background:white;color:#174f3f;border:1px solid rgba(23,79,63,.25)}.danger{background:#9d3028;color:white;flex:1}.ghost{background:transparent;color:#43504a;text-decoration:underline}.hidden{display:none!important}.status{margin:10px 2px 13px;color:#59625e;font-size:12px;line-height:1.4}details{background:white;border:1px solid rgba(0,0,0,.09);border-radius:14px;padding:12px}summary{font-weight:750;font-size:14px;cursor:pointer}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.form-grid label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#616b66}.form-grid .full{grid-column:1/-1}.form-grid input[type=text],.form-grid input[type=date],.form-grid input[type=number]{width:100%;height:39px;border:1px solid #ced2ce;border-radius:9px;background:#fbfbf8;color:#19201e;padding:0 10px;font:14px sans-serif}.check{flex-direction:row!important;align-items:center;font-size:13px!important;color:#303835!important}.check input{width:18px;height:18px;accent-color:#174f3f}.candidate-summary{margin:12px 0 0;padding-top:10px;border-top:1px solid #e5e5df;font-size:12px;color:#174f3f;font-weight:700}.draw{width:100%;min-height:52px;margin-top:12px;border:0;border-radius:13px;background:#d7f36b;color:#174f3f;font-size:17px;font-weight:800;cursor:pointer}.draw:disabled{background:#dfe1da;color:#90958f;cursor:not-allowed}.results{margin-top:14px;padding:14px;background:#174f3f;color:white;border-radius:14px}.results h2{margin:0 0 12px;font-size:18px}.results h3{margin:12px 0 6px;font-size:12px;color:#d7f36b;letter-spacing:.08em}.results ol{margin:0;padding-left:25px}.results li{padding:7px 0;border-bottom:1px solid rgba(255,255,255,.14)}.results a,.results li>span{display:block;color:white;font-weight:750;font-size:15px}.results small{color:rgba(255,255,255,.65);font-size:11px}.export-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.export-row .secondary{border:0}.results .ghost{color:white}.footer-note{margin:13px 4px 0;color:#777e7a;font-size:10px;line-height:1.45}
.error-card{margin:0 0 13px;padding:13px;background:#fff0ee;border:1px solid #e4a19b;border-left:4px solid #b9382e;border-radius:12px;color:#67221d}.error-card strong{display:block;font-size:14px}.error-card p{margin:6px 0 9px;font-size:12px;line-height:1.45}.error-card code{display:inline-block;padding:4px 7px;border-radius:6px;background:#f5d6d2;color:#852b24;font:700 11px ui-monospace,monospace}.error-card div{display:flex;align-items:center;gap:8px;margin-top:10px}.error-button{min-height:36px;background:#b9382e;color:white}.error-card span{font-size:10px;color:#852b24}@media(max-width:520px){:host{left:10px;right:10px}.panel{width:100%;max-height:calc(100dvh - 20px)}.form-grid{gap:8px}.body{padding:12px}}
</style>`; }
