import { describe, expect, it, vi } from 'vitest';
import { createRaffleProof, drawRaffle, filterComments, participantsFrom, verifyRaffleProof } from '../src/raffle';
import { parseFacebookDate } from '../src/parser';
import type { FacebookComment } from '../src/types';

const comments: FacebookComment[] = [
  { id: '1', authorName: 'Alice', authorUrl: 'https://facebook.com/a', body: '參加 抽獎', createdAt: '2026-08-20T00:00:00.000Z', kind: 'comment' },
  { id: '2', authorName: 'Alice', authorUrl: 'https://facebook.com/a', body: '再參加 抽獎', createdAt: '2026-08-21T00:00:00.000Z', kind: 'comment' },
  { id: '3', authorName: 'Host', authorUrl: 'https://facebook.com/h', body: '抽獎', createdAt: '2026-08-21T00:00:00.000Z', kind: 'comment' },
  { id: '4', authorName: 'Bob', body: '不相關', createdAt: '2026-08-22T00:00:00.000Z', kind: 'comment' },
];

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

async function refreshIntegrityHash(proof: Awaited<ReturnType<typeof createRaffleProof>>): Promise<void> {
  const { integrityHash: _oldHash, ...record } = proof;
  const bytes = new TextEncoder().encode(stableSerialize(record));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  proof.integrityHash = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('raffle core', () => {
  it('filters then deduplicates participants by profile URL', () => {
    const eligible = filterComments(comments, { name: 'Host', url: 'https://facebook.com/h' }, { keyword: '抽獎', excludePostAuthor: true, startDate: '2026-08-20', endDate: '2026-08-21' });
    expect(participantsFrom(eligible)).toMatchObject([{ authorName: 'Alice', commentIds: ['1', '2'] }]);
  });
  it('draws unique winners and alternates using crypto randomness', () => {
    vi.stubGlobal('crypto', { getRandomValues: (target: Uint32Array) => { target[0] = 0; return target; }, subtle: globalThis.crypto.subtle });
    const result = drawRaffle(comments, undefined, { keyword: '抽獎' }, 1, 1);
    expect(result.winners[0]!.authorName).not.toBe(result.alternates[0]!.authorName);
    expect(result.randomValues.length).toBe(2);
    vi.unstubAllGlobals();
  });
  it('creates a proof with no personally identifying text', async () => {
    const result = { participants: participantsFrom(comments), winners: participantsFrom(comments).slice(0, 1), alternates: [], randomValues: [0] };
    const proof = await createRaffleProof(result, { keyword: '抽獎' }, 'https://facebook.com/posts/1', '2026-08-28T00:00:00.000Z');
    expect(JSON.stringify(proof)).not.toContain('Alice');
    expect(proof.candidateListHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyRaffleProof(proof)).toBe(true);
    proof.winnerTokens[0] = 'tampered';
    expect(await verifyRaffleProof(proof)).toBe(false);
  });
  it('rejects modified proof metadata and impossible random values', async () => {
    const people = participantsFrom(comments);
    const result = { participants: people, winners: people.slice(0, 1), alternates: [], randomValues: [0] };
    const proof = await createRaffleProof(result, { keyword: '抽獎' }, 'https://facebook.com/posts/1');
    expect(await verifyRaffleProof(proof, 'https://facebook.com/posts/1')).toBe(true);
    for (const mutate of [
      (copy: typeof proof) => { copy.rules = { keyword: '被修改' }; },
      (copy: typeof proof) => { copy.sourcePageHash = '0'.repeat(64); },
      (copy: typeof proof) => { copy.randomValues[0] = 0.5; },
      (copy: typeof proof) => { copy.randomValues.push(1); },
      (copy: typeof proof) => { copy.winnerCount = 100; },
    ]) {
      const copy = structuredClone(proof);
      mutate(copy);
      expect(await verifyRaffleProof(copy, 'https://facebook.com/posts/1')).toBe(false);
    }
  });

  it('verifies older tool versions when the proof format is still supported', async () => {
    const people = participantsFrom(comments);
    const proof = await createRaffleProof(
      { participants: people, winners: people.slice(0, 1), alternates: [], randomValues: [0] },
      {},
      'https://facebook.com/posts/legacy',
    );
    proof.toolVersion = '0.1.0';
    await refreshIntegrityHash(proof);
    expect(await verifyRaffleProof(proof)).toBe(true);
  });

  it('keeps unrelated people with the same display name separate when profile URLs are absent', () => {
    const people = participantsFrom([
      { id: 'same-1', authorName: '王小明', body: '參加', kind: 'comment' },
      { id: 'same-2', authorName: '王小明', body: '參加', kind: 'comment' },
    ]);
    expect(people).toHaveLength(2);
  });
  it('compares Chinese timestamps against local calendar-day boundaries', () => {
    const createdAt = parseFacebookDate('2026年8月21日 00:30')!;
    const eligible = filterComments([
      { id: 'midnight', authorName: '午夜參加者', body: '參加', createdAt, kind: 'comment' },
      { id: 'unknown', authorName: '無時間', body: '參加', kind: 'comment' },
    ], undefined, { startDate: '2026-08-21', endDate: '2026-08-21' });
    expect(eligible.map((comment) => comment.id)).toEqual(['midnight']);
  });
});
