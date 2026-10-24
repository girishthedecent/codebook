import type { SourceType } from '../../generated/prisma/enums.js';
import type { CallContext } from '../../llm/client.js';
import type { EmbedKind } from '../../llm/embeddings.js';
import type { ModelRef } from '../../llm/models.js';
import type { SEARCH_MODES } from '../workspaces/workspace.validator.js';

export type SearchMode = (typeof SEARCH_MODES)[number];

export const QUERY_MODES = ['none', 'rewrite', 'hyde', 'decompose'] as const;
export type QueryMode = (typeof QUERY_MODES)[number];

export type HistoryTurn = { role: 'user' | 'assistant'; content: string };

export type SearchOptions = {
  // For usage rows. Access is the caller's job; the queries filter by workspaceId.
  userId: string;
  workspaceId: string;
  // The chat message the search runs for, so its model calls count toward that turn.
  messageId?: string;
  query: string;
  // Earlier turns of the conversation, for the rewrite mode.
  history?: HistoryTurn[];
  sourceIds?: string[];
  sourceTypes?: SourceType[];
  pathPrefix?: string;
  mode?: SearchMode;
  queryMode?: QueryMode;
  rerank?: boolean;
  topK?: number;
  expandParents?: boolean;
  // Token budget for the parent blocks; defaults to retrieval.maxContextTokens.
  maxContextTokens?: number;
  // Evals pin the query-mode model (no fallback) and compare reranker models.
  modelOverride?: ModelRef;
  rerankerModel?: string;
  signal?: AbortSignal;
};

export type ChunkScores = {
  vector?: number;
  keyword?: number;
  rrf?: number;
  rerank?: number;
};

/** One child chunk: what citations point at and what evals score. */
export type RetrievedChunk = {
  chunkId: string;
  parentId: string | null;
  sourceId: string;
  sourceTitle: string;
  sourceType: SourceType;
  // File path for repositories, final URL for web pages, the file name for PDFs.
  documentPath: string;
  headingPath: string[];
  symbolName: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  content: string;
  context: string | null;
  scores: ChunkScores;
};

/** A parent section to read, standing for the children of it that were found. */
export type ContextBlock = {
  // The chunk's own id when it has no parent.
  parentId: string;
  sourceId: string;
  sourceTitle: string;
  documentPath: string;
  headingPath: string[];
  content: string;
  tokenCount: number;
  childIds: string[];
  score: number;
};

export type StageTimings = {
  queryMode?: number;
  embed: number;
  vector: number;
  keyword: number;
  rerank: number;
  parents: number;
  total: number;
};

export type SearchDebug = {
  weak: boolean;
  // Chunk ids in final order before the score threshold; evals rank on this.
  ranked: string[];
  rerank: 'used' | 'off' | 'unavailable';
  queryModeError?: string;
  // The query-mode model call was answered by the fallback model.
  fallbackUsed: boolean;
  // What the query mode generated (rewritten question, hypothetical passage, sub-queries).
  queries: string[];
  candidates: { vector: number; keyword: number; fused: number };
  timings: StageTimings;
};

export type SearchResult = {
  results: RetrievedChunk[];
  parents: ContextBlock[];
  debug: SearchDebug;
};

/** What one search runs: every vector and keyword query is searched and fused in one RRF. */
export type ExpandedQuery = {
  vectorQueries: { text: string; kind: EmbedKind }[];
  keywordQueries: string[];
  // Always the user's question, so a generated text never decides the final order.
  rerankQuery: string;
  generated: string[];
  error?: string;
  fallbackUsed: boolean;
};

export type ExpandQueryOptions = {
  history?: HistoryTurn[];
  modelOverride?: ModelRef;
  ctx?: CallContext;
  signal?: AbortSignal;
};

export type RerankOptions = {
  // Defaults to RERANKER_MODEL.
  model?: string;
  ctx?: CallContext;
  signal?: AbortSignal;
};
