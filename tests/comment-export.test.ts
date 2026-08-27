import { describe, expect, it } from 'vitest';
import { commentsToCsv, commentsToText, orderedComments } from '../src/comment-export';
import type { FacebookComment } from '../src/types';

const main: FacebookComment = { id: 'main', sequence: 1, kind: 'comment', authorName: '=危險名稱', body: '第一行,\n第二行' };
const reply: FacebookComment = { id: 'reply', sequence: 2, kind: 'reply', authorName: '小美', body: '我也來', replyToAuthorName: '=危險名稱' };

describe('full comment export', () => {
  it('merges main comments and replies in discovery order', () => {
    expect(orderedComments({ comments: [main], replies: [reply] }).map((comment) => comment.id)).toEqual(['main', 'reply']);
  });

  it('writes Excel-friendly CSV with quoting, BOM, and formula protection', () => {
    const csv = commentsToCsv([main, reply]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=危險名稱"');
    expect(csv).toContain('"第一行,\n第二行"');
    expect(csv).toContain('"回覆"');
    expect(commentsToCsv([{ ...main, authorName: '\t=仍是公式' }])).toContain('"\'\t=仍是公式"');
  });

  it('writes a readable complete TXT representation', () => {
    expect(commentsToText([main, reply])).toContain('1. 主留言');
    expect(commentsToText([main, reply])).toContain('回覆對象：=危險名稱');
  });
});
