export type CommentKind = 'comment' | 'reply';

export interface FacebookComment {
  id: string;
  /** Stable discovery order within this local loading session. */
  sequence?: number;
  authorName: string;
  authorUrl?: string;
  body: string;
  createdAt?: string;
  kind: CommentKind;
  replyToAuthorName?: string;
  commentUrl?: string;
  facebookId?: string;
  media?: Array<{ kind: 'image' | 'sticker'; url?: string }>;
}

export interface ParsedFacebookPost {
  postAuthor?: { name: string; url?: string };
  comments: FacebookComment[];
  replies: FacebookComment[];
  diagnostics: string[];
}

export interface RaffleFilters {
  keyword?: string;
  excludePostAuthor?: boolean;
  startDate?: string;
  endDate?: string;
  /** Defaults to one entry for each participant. */
  oneEntryPerPerson?: boolean;
}

export interface Participant {
  key: string;
  authorName: string;
  authorUrl?: string;
  commentIds: string[];
  comments: FacebookComment[];
}

export interface RaffleResult {
  participants: Participant[];
  winners: Participant[];
  alternates: Participant[];
  randomValues: number[];
}

export interface RaffleProof {
  version: 1;
  toolVersion: string;
  algorithm: 'crypto-rejection-sampling-v1';
  createdAt: string;
  rules: RaffleFilters;
  sourcePageHash: string;
  winnerCount: number;
  alternateCount: number;
  candidateCount: number;
  /** Opaque, randomly generated tokens in the exact draw order. */
  candidateTokens: string[];
  candidateListHash: string;
  winnerTokens: string[];
  alternateTokens: string[];
  randomValues: number[];
  integrityHash: string;
}
