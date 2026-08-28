import type { FacebookComment, LoadVerificationStatus, ParsedFacebookPost } from './types';

export interface CommentExportMetadata {
  snapshotId: string;
  verificationStatus: LoadVerificationStatus;
  reportedCommentTotal?: number;
  parsedTotal: number;
}

export interface FullCommentExport {
  toolVersion: string;
  exportedAt: string;
  snapshotId: string;
  snapshotCapturedAt: string;
  sourcePage: string;
  postAuthor?: ParsedFacebookPost['postAuthor'];
  load: {
    outcome: string;
    reportedCommentTotal?: number;
    mainComments: number;
    replies: number;
    total: number;
    pendingExpansionControls: boolean;
    complete: boolean;
    verificationStatus: LoadVerificationStatus;
    reportedGap: number;
    stablePasses: number;
  };
  comments: FacebookComment[];
}

export function orderedComments(parsed: Pick<ParsedFacebookPost, 'comments' | 'replies'>): FacebookComment[] {
  return [...parsed.comments, ...parsed.replies]
    .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
}

export function commentsToText(comments: FacebookComment[], metadata?: CommentExportMetadata): string {
  const content = comments.map((comment, index) => {
    const lines = [
      `${index + 1}. ${comment.kind === 'reply' ? '回覆' : '主留言'}`,
      `作者：${comment.authorName}`,
      ...(comment.replyToAuthorName ? [`回覆對象：${comment.replyToAuthorName}`] : []),
      ...(comment.createdAt ? [`時間：${formatLocalDate(comment.createdAt)}`] : []),
      `內容：${comment.body || mediaLabel(comment) || '（無文字內容）'}`,
      ...(comment.commentUrl ? [`留言連結：${comment.commentUrl}`] : []),
      ...(comment.facebookId ? [`Facebook ID：${comment.facebookId}`] : []),
      ...(comment.media?.length ? [`媒體：${mediaLabel(comment)}`] : []),
    ];
    return lines.join('\n');
  }).join('\n\n');
  if (!metadata) return content;
  const summary = [
    `資料快照：${metadata.snapshotId}`,
    `驗證狀態：${metadata.verificationStatus}`,
    `Facebook 顯示總數：${metadata.reportedCommentTotal ?? '無法取得'}`,
    `實際讀取總數：${metadata.parsedTotal}`,
  ].join('\n');
  return `${summary}\n\n${content}`;
}

export function commentsToCsv(comments: FacebookComment[], metadata?: CommentExportMetadata): string {
  const headers = ['序號', '類型', '留言者', '留言者連結', '留言內容', '時間', '回覆對象', '留言連結', 'Facebook ID', '媒體', '資料快照', '驗證狀態', 'Facebook顯示總數', '實際讀取總數'];
  const rows = comments.map((comment, index) => [
    String(index + 1),
    comment.kind === 'reply' ? '回覆' : '主留言',
    comment.authorName,
    comment.authorUrl ?? '',
    comment.body,
    comment.createdAt ? formatLocalDate(comment.createdAt) : '',
    comment.replyToAuthorName ?? '',
    comment.commentUrl ?? '',
    comment.facebookId ?? '',
    mediaLabel(comment),
    metadata?.snapshotId ?? '',
    metadata?.verificationStatus ?? '',
    metadata?.reportedCommentTotal === undefined ? '' : String(metadata.reportedCommentTotal),
    String(metadata?.parsedTotal ?? comments.length),
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

export function formatLocalDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function mediaLabel(comment: FacebookComment): string {
  return (comment.media ?? []).map((media) => `${media.kind === 'sticker' ? '貼圖' : '圖片'}${media.url ? `：${media.url}` : ''}`).join('；');
}

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
