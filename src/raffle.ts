import type { FacebookComment, Participant, RaffleFilters, RaffleProof, RaffleResult } from './types';
import { TOOL_VERSION } from './version';

const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
type PostAuthor = { name: string; url?: string };

function localDateBoundary(value: string | undefined, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(`${value.slice(0, 10)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

export function filterComments(comments: FacebookComment[], postAuthor: PostAuthor | undefined, filters: RaffleFilters = {}): FacebookComment[] {
  const keyword = filters.keyword ? normalized(filters.keyword) : undefined;
  const start = localDateBoundary(filters.startDate, false);
  const end = localDateBoundary(filters.endDate, true);
  return comments.filter((comment) => {
    if (keyword && !normalized(comment.body).includes(keyword)) return false;
    if (filters.excludePostAuthor && postAuthor) {
      const sameUrl = postAuthor.url && comment.authorUrl && postAuthor.url === comment.authorUrl;
      const sameFallbackName = !postAuthor.url && !comment.authorUrl && normalized(comment.authorName) === normalized(postAuthor.name);
      if (sameUrl || sameFallbackName) return false;
    }
    const timestamp = comment.createdAt ? new Date(comment.createdAt).getTime() : undefined;
    if (start !== undefined && (timestamp === undefined || Number.isNaN(timestamp) || timestamp < start)) return false;
    if (end !== undefined && (timestamp === undefined || Number.isNaN(timestamp) || timestamp > end)) return false;
    return true;
  });
}

export function participantsFrom(comments: FacebookComment[], oneEntryPerPerson = true): Participant[] {
  const groups = new Map<string, Participant>();
  comments.forEach((comment) => {
    // Without a profile URL, merging by display name can collapse unrelated people.
    const identity = comment.authorUrl ? `url:${comment.authorUrl}` : `comment:${comment.id}`;
    const key = oneEntryPerPerson ? identity : `${identity}:${comment.id}`;
    const existing = groups.get(key);
    if (existing) { existing.commentIds.push(comment.id); existing.comments.push(comment); }
    else groups.set(key, { key, authorName: comment.authorName, ...(comment.authorUrl ? { authorUrl: comment.authorUrl } : {}), commentIds: [comment.id], comments: [comment] });
  });
  return [...groups.values()];
}

function secureIndex(limit: number, randomValues: number[]): number {
  if (limit < 1) throw new Error('抽獎名單不可為空');
  const maximum = Math.floor(0x100000000 / limit) * limit;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('此瀏覽器不支援安全亂數');
  const array = new Uint32Array(1);
  do {
    cryptoApi.getRandomValues(array);
    const value = array[0]!;
    randomValues.push(value);
    if (value < maximum) return value % limit;
  } while (true);
}

export function drawRaffle(comments: FacebookComment[], postAuthor: PostAuthor | undefined, filters: RaffleFilters = {}, winnerCount = 1, alternateCount = 0): RaffleResult {
  const participants = participantsFrom(filterComments(comments, postAuthor, filters), filters.oneEntryPerPerson !== false);
  const pool = [...participants];
  const randomValues: number[] = [];
  const pick = (count: number): Participant[] => Array.from(
    { length: Math.min(Math.max(0, count), pool.length) },
    () => pool.splice(secureIndex(pool.length, randomValues), 1)[0]!,
  );
  return { participants, winners: pick(winnerCount), alternates: pick(alternateCount), randomValues };
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function opaqueToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A shareable proof uses unlinkable tokens and never includes names, URLs, or comment text. */
export async function createRaffleProof(
  result: RaffleResult,
  rules: RaffleFilters,
  sourcePage = location.href,
  createdAt = new Date().toISOString(),
): Promise<RaffleProof> {
  const tokens = new Map(result.participants.map((person) => [person.key, opaqueToken()]));
  const candidateTokens = result.participants.map((person) => tokens.get(person.key)!);
  const record = {
    version: 1 as const, toolVersion: TOOL_VERSION, algorithm: 'crypto-rejection-sampling-v1' as const, createdAt, rules,
    sourcePageHash: await digest(sourcePage), winnerCount: result.winners.length, alternateCount: result.alternates.length,
    candidateCount: candidateTokens.length,
    candidateTokens, candidateListHash: await digest(candidateTokens.join('\n')),
    winnerTokens: result.winners.map((person) => tokens.get(person.key)!),
    alternateTokens: result.alternates.map((person) => tokens.get(person.key)!), randomValues: [...result.randomValues],
  };
  return { ...record, integrityHash: await digest(stableSerialize(record)) };
}

/** Replays the committed token order and recorded rejection-sampling values. */
export async function verifyRaffleProof(proof: RaffleProof, sourcePage?: string): Promise<boolean> {
  const { integrityHash, ...record } = proof;
  if (await digest(stableSerialize(record)) !== integrityHash) return false;
  if (proof.version !== 1 || !/^\d+\.\d+\.\d+$/.test(proof.toolVersion) || proof.algorithm !== 'crypto-rejection-sampling-v1') return false;
  if (!/^[a-f0-9]{64}$/.test(proof.sourcePageHash)) return false;
  if (sourcePage && await digest(sourcePage) !== proof.sourcePageHash) return false;
  if (!Number.isInteger(proof.winnerCount) || !Number.isInteger(proof.alternateCount)
    || proof.winnerCount < 0 || proof.alternateCount < 0
    || proof.winnerCount + proof.alternateCount > proof.candidateCount) return false;
  if (proof.randomValues.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) return false;
  if (new Set(proof.candidateTokens).size !== proof.candidateTokens.length
    || proof.candidateTokens.some((token) => !/^[a-f0-9]{48}$/.test(token))) return false;
  if (proof.candidateCount !== proof.candidateTokens.length) return false;
  if (await digest(proof.candidateTokens.join('\n')) !== proof.candidateListHash) return false;
  const pool = [...proof.candidateTokens];
  let randomIndex = 0;
  const pick = (count: number): string[] => {
    const picked: string[] = [];
    while (picked.length < count && pool.length) {
      const maximum = Math.floor(0x100000000 / pool.length) * pool.length;
      let value: number;
      do {
        value = proof.randomValues[randomIndex++] ?? Number.NaN;
        if (!Number.isFinite(value)) return [];
      } while (value >= maximum);
      picked.push(pool.splice(value % pool.length, 1)[0]!);
    }
    return picked;
  };
  const winners = pick(proof.winnerCount);
  const alternates = pick(proof.alternateCount);
  return randomIndex === proof.randomValues.length
    && winners.length === proof.winnerTokens.length
    && alternates.length === proof.alternateTokens.length
    && winners.every((token, index) => token === proof.winnerTokens[index])
    && alternates.every((token, index) => token === proof.alternateTokens[index]);
}
