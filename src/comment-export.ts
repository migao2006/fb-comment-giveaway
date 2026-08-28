import type { FacebookComment, LoadVerificationStatus, ParsedFacebookPost } from './types';

export interface CommentExportMetadata {
  snapshotId: string;
  verificationStatus: LoadVerificationStatus;
  parsedTotal: number;
}

export function orderedComments(parsed: Pick<ParsedFacebookPost, 'comments' | 'replies'>): FacebookComment[] {
  return [...parsed.comments]
    .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
}

export function commentsToCsv(comments: FacebookComment[], metadata?: CommentExportMetadata): string {
  const headers = ['序號', '留言者', '留言者連結', '留言內容', '時間', '留言連結', 'Facebook ID', '媒體', '資料快照', '驗證狀態', '實際讀取總數'];
  const mainComments = comments.filter((comment) => comment.kind === 'comment');
  const rows = mainComments.map((comment, index) => [
    String(index + 1),
    comment.authorName,
    comment.authorUrl ?? '',
    comment.body,
    comment.createdAt ? formatLocalDate(comment.createdAt) : '',
    comment.commentUrl ?? '',
    comment.facebookId ?? '',
    mediaLabel(comment),
    metadata?.snapshotId ?? '',
    metadata?.verificationStatus ?? '',
    String(metadata?.parsedTotal ?? mainComments.length),
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
