import { appConfig } from '../../config/app.config.js';
import { serverConfig } from '../../config/index.js';
import logger from '../../config/logger.config.js';
import { embedTexts, type EmbedKind } from '../../llm/embeddings.js';
import { rerank as rerankDocs } from '../../llm/reranker.js';
import { withRerankSlot } from '../../utils/rateLimit.js';
import { BadRequestError, UpstreamError } from '../../utils/errors/app.error.js';
import { excerptOf } from '../demo/excerpt.js';
import { identifierWords } from '../ingestion/code/identifiers.js';
import type { WorkspaceSettings } from '../workspaces/workspace.dto.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';
import { bestScores, rrf } from './fusion.js';
import { expandQuery } from './queryModes.js';
import {
  findChunks,
  findParents,
  keywordSearch,
  vectorSearch,
  type ChunkFilters,
  type ChunkRow,
  type ScoredId,
} from './retrieval.repository.js';
import type { SearchInput } from './retrieval.dto.js';
import type {
  ContextBlock,
  ExpandedQuery,
  RetrievedChunk,
  SearchDebug,
  SearchOptions,
  SearchResult,
  StageTimings,
} from './retrieval.types.js';

const config = appConfig.retrieval;

/** Milliseconds since `start`, rounded for logs and debug output. */
const since = (start: number) => Math.round(performance.now() - start);

const callContext = ({ userId, workspaceId, messageId }: SearchOptions) => ({
  userId,
  workspaceId,
  messageId,
});

export function rerankThresholds(model: string) {
  const thresholds = config.reranker.thresholds[model];
  if (!thresholds) throw new Error(`No rerank thresholds configured for ${model}`);
  return thresholds;
}

/** What the reranker reads for a chunk: where it is, the context note, then the text. */
export function rerankText(chunk: RetrievedChunk) {
  const place = chunk.headingPath.length > 0 ? chunk.headingPath : [chunk.documentPath];
  const breadcrumb = [chunk.sourceTitle, ...place, chunk.symbolName]
    .filter((part) => part)
    .join(' › ');
  return [breadcrumb, chunk.context, chunk.content].filter((part) => part).join('\n\n');
}

async function vectorLists(
  queries: ExpandedQuery['vectorQueries'],
  filters: ChunkFilters,
  options: SearchOptions,
  timings: StageTimings,
) {
  let started = performance.now();
  const ctx = callContext(options);
  const vectors: { kind: EmbedKind; vector: number[] }[] = [];
  for (const kind of ['query', 'document'] satisfies EmbedKind[]) {
    const texts = queries.filter((query) => query.kind === kind).map((query) => query.text);
    if (texts.length === 0) continue;
    const embedded = await embedTexts(texts, {
      kind,
      ctx,
      abortSignal: options.signal,
      waitForQuota: false,
    });
    vectors.push(...embedded.map((vector) => ({ kind, vector })));
  }
  timings.embed = since(started);

  // One after another: each search holds a pooled connection for its transaction, and a
  // decomposed question has up to four of them.
  started = performance.now();
  const lists: { kind: EmbedKind; list: ScoredId[] }[] = [];
  for (const { kind, vector } of vectors) {
    const list = await vectorSearch(vector, filters, config.candidateK, config.efSearch);
    lists.push({ kind, list });
  }
  timings.vector = since(started);
  return lists;
}

async function keywordLists(queries: string[], filters: ChunkFilters, timings: StageTimings) {
  const started = performance.now();
  const lists = await Promise.all(
    queries.map((query) =>
      keywordSearch(query, identifierWords(query).join(' '), filters, config.candidateK),
    ),
  );
  timings.keyword = since(started);
  return lists;
}

function toRetrieved(chunk: ChunkRow, scores: RetrievedChunk['scores']): RetrievedChunk {
  const { id, ...rest } = chunk;
  return { chunkId: id, ...rest, scores };
}

/**
 * Parent sections for the found children, best first, one block per parent, until the
 * token budget runs out (a block that doesn't fit is skipped; the first always goes in).
 */
async function parentBlocks(
  workspaceId: string,
  results: RetrievedChunk[],
  score: Scorer,
  maxTokens: number,
) {
  const parentIds = [...new Set(results.flatMap((chunk) => chunk.parentId ?? []))];
  const parents = new Map((await findParents(workspaceId, parentIds)).map((p) => [p.id, p]));

  const blocks = new Map<string, ContextBlock>();
  for (const chunk of results) {
    const parent = chunk.parentId ? parents.get(chunk.parentId) : undefined;
    // Its parent was replaced by a re-index since the chunk was read; the next search sees
    // the new index.
    if (chunk.parentId && !parent) continue;
    const key = parent?.id ?? chunk.chunkId;
    const existing = blocks.get(key);
    if (existing) {
      existing.childIds.push(chunk.chunkId);
      continue;
    }
    blocks.set(key, {
      parentId: key,
      sourceId: chunk.sourceId,
      sourceTitle: chunk.sourceTitle,
      documentPath: chunk.documentPath,
      headingPath: parent?.headingPath ?? chunk.headingPath,
      content: parent?.content ?? chunk.content,
      // A child standing in for its parent: about as long as the parent's share of it.
      tokenCount: parent?.tokenCount ?? Math.ceil(chunk.content.length / 4),
      childIds: [chunk.chunkId],
      score: score(chunk),
    });
  }

  // Results are already in score order, so blocks are too.
  const kept: ContextBlock[] = [];
  let tokens = 0;
  for (const block of blocks.values()) {
    if (kept.length > 0 && tokens + block.tokenCount > maxTokens) continue;
    kept.push(block);
    tokens += block.tokenCount;
  }
  return kept;
}

type Scorer = (chunk: RetrievedChunk) => number;

/**
 * Hybrid search over one workspace's child chunks: the (expanded) query runs as vector and
 * keyword searches, the lists are fused with RRF, the best candidates are reranked against
 * the user's question, weak results are dropped, and the parents of what's left are the
 * text a model reads. The caller has already checked access to the workspace.
 */
export async function search(options: SearchOptions): Promise<SearchResult> {
  const started = performance.now();
  const mode = options.mode ?? 'hybrid';
  const queryMode = options.queryMode ?? 'none';
  const topK = Math.min(options.topK ?? config.defaultTopK, config.maxTopK);
  const rerankerModel = options.rerankerModel ?? serverConfig.RERANKER_MODEL;
  const filters: ChunkFilters = {
    workspaceId: options.workspaceId,
    sourceIds: options.sourceIds,
    sourceTypes: options.sourceTypes,
    pathPrefix: options.pathPrefix,
  };
  const timings: StageTimings = {
    embed: 0,
    vector: 0,
    keyword: 0,
    rerank: 0,
    parents: 0,
    total: 0,
  };

  let stageStart = performance.now();
  const expanded = await expandQuery(options.query, queryMode, {
    history: options.history,
    modelOverride: options.modelOverride,
    ctx: callContext(options),
    signal: options.signal,
  });
  if (queryMode !== 'none') timings.queryMode = since(stageStart);

  // A hybrid search whose question can't be embedded (the embedding quota is out) still
  // has its keyword matches; a vector-only search has nothing to fall back on.
  const [vectorResult, keywords] = await Promise.all([
    mode === 'keyword'
      ? []
      : vectorLists(expanded.vectorQueries, filters, options, timings).catch((error: unknown) => {
          if (mode === 'vector' || !(error instanceof UpstreamError)) throw error;
          logger.warn('Search embedding failed; using keyword matches only', {
            workspaceId: options.workspaceId,
          });
          return null;
        }),
    mode === 'vector' ? [] : keywordLists(expanded.keywordQueries, filters, timings),
  ]);
  options.signal?.throwIfAborted();
  const keywordOnly = vectorResult === null;
  const vectors = vectorResult ?? [];

  const vectorScores = bestScores(vectors.map(({ list }) => list));
  // The weak check compares question-to-chunk similarity; a HyDE passage, embedded as a
  // document, scores on a higher scale.
  const questionScores = bestScores(
    vectors.filter(({ kind }) => kind === 'query').map(({ list }) => list),
  );
  const keywordScores = bestScores(keywords);
  const lists = [...vectors.map(({ list }) => list), ...keywords];
  const weights = [...vectors.map(() => 1), ...keywords.map(() => config.keywordWeight)];
  const fused = rrf(lists, config.rrfK, vectorScores, weights).slice(
    0,
    Math.max(config.rerankK, topK),
  );
  const rows = new Map(
    (
      await findChunks(
        options.workspaceId,
        fused.map((item) => item.id),
      )
    ).map((row) => [row.id, row]),
  );
  // A chunk deleted by a re-index between the two queries is simply left out.
  let candidates = fused.flatMap((item) => {
    const row = rows.get(item.id);
    if (!row) return [];
    return [
      toRetrieved(row, {
        vector: vectorScores.get(item.id),
        keyword: keywordScores.get(item.id),
        rrf: item.rrf,
      }),
    ];
  });

  let rerankState: SearchDebug['rerank'] = 'off';
  if ((options.rerank ?? config.rerankByDefault) && candidates.length > 0) {
    stageStart = performance.now();
    // Too many reranks running already: this search keeps the fused order.
    const slot = await withRerankSlot(() =>
      rerankDocs(expanded.rerankQuery, candidates.map(rerankText), {
        model: rerankerModel,
        ctx: callContext(options),
        signal: options.signal,
      }),
    );
    const scores = slot.ran ? slot.value : null;
    timings.rerank = since(stageStart);
    if (scores) {
      rerankState = 'used';
      candidates.forEach((chunk, i) => (chunk.scores.rerank = scores[i]));
      // Stable sort: equal rerank scores keep the fused order.
      candidates = [...candidates].sort((a, b) => b.scores.rerank! - a.scores.rerank!);
    } else {
      rerankState = 'unavailable';
    }
  }

  let results: RetrievedChunk[];
  let weak: boolean;
  if (rerankState === 'used') {
    const { min, weak: weakScore } = rerankThresholds(rerankerModel);
    results = candidates.filter((chunk) => chunk.scores.rerank! >= min).slice(0, topK);
    weak = results.length === 0 || results[0]!.scores.rerank! < weakScore;
  } else {
    results = candidates.slice(0, topK);
    const bestVector = Math.max(...questionScores.values());
    weak = results.length === 0 || (mode !== 'keyword' && bestVector < config.weakVectorScore);
  }
  // Keyword matches stand in for a search that couldn't run: never present them as strong.
  if (keywordOnly) weak = true;

  stageStart = performance.now();
  const score: Scorer = (chunk) => chunk.scores.rerank ?? chunk.scores.rrf ?? 0;
  const parents =
    options.expandParents === false || results.length === 0
      ? []
      : await parentBlocks(
          options.workspaceId,
          results,
          score,
          options.maxContextTokens ?? config.maxContextTokens,
        );
  timings.parents = since(stageStart);
  timings.total = since(started);

  const debug: SearchDebug = {
    weak,
    keywordOnly,
    ranked: candidates.map((chunk) => chunk.chunkId),
    rerank: rerankState,
    queryModeError: expanded.error,
    fallbackUsed: expanded.fallbackUsed,
    queries: expanded.generated,
    candidates: {
      vector: vectorScores.size,
      keyword: keywordScores.size,
      fused: fused.length,
    },
    timings,
  };
  logger.info('Search', {
    workspaceId: options.workspaceId,
    mode,
    queryMode,
    rerank: rerankState,
    results: results.length,
    weak,
    ...(keywordOnly && { keywordOnly }),
    timings,
  });
  return { results, parents, debug };
}

// As long as a citation's snippet.
const DEMO_SNIPPET_CHARS = 300;

/**
 * The debug search endpoint: anyone may search the demo workspace, but not spend model calls
 * or reranker CPU on it, nor read more of a hit than a citation shows.
 */
export async function searchWorkspaceService(
  userId: string,
  workspaceId: string,
  input: SearchInput,
  signal?: AbortSignal,
) {
  const workspace = await assertWorkspaceAccess(userId, workspaceId, { allowDemoRead: true });
  const owner = workspace.userId === userId;
  if (!owner && (input.queryMode !== 'none' || input.rerank === true)) {
    throw new BadRequestError('Query modes and reranking are not available on the demo workspace');
  }
  const settings = workspace.settings as WorkspaceSettings;
  const result = await search({
    ...input,
    userId,
    workspaceId,
    mode: input.mode ?? settings.defaultSearchMode ?? 'hybrid',
    rerank: owner ? input.rerank : false,
    // Parent sections are whole pages of the demo's book; visitors get snippets only.
    expandParents: owner ? input.expandParents : false,
    signal,
  });
  if (owner) return result;
  return {
    ...result,
    results: result.results.map((chunk) => ({
      ...chunk,
      content: excerptOf(chunk.content, DEMO_SNIPPET_CHARS).text,
      context: chunk.context && excerptOf(chunk.context, DEMO_SNIPPET_CHARS).text,
    })),
  };
}
