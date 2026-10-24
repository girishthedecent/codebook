import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import { Prisma, type EvalCase, type EvalResult } from '../src/generated/prisma/client.js';
import type { EvalSplit } from '../src/generated/prisma/enums.js';
import { embedTexts } from '../src/llm/embeddings.js';
import { embeddingRoute, textRoutes } from '../src/llm/models.js';
import { prompts } from '../src/llm/prompts/index.js';
import { search } from '../src/modules/retrieval/retrieval.service.js';
import type {
  ChunkScores,
  SearchDebug,
  SearchResult,
} from '../src/modules/retrieval/retrieval.types.js';
import { createPacer } from '../src/utils/pacer.js';
import type { RetrievalConfig } from './config.js';
import { loadCorpus } from './corpusWorkspace.js';
import { expectedRefSchema } from './dataset.js';
import { refHits, type MatchableChunk } from './matching.js';
import {
  scoreRanking,
  summarize,
  type CaseOutcome,
  type RankingScores,
} from './scorers/retrieval.js';

// Runs one retrieval config over a dataset's cases: one EvalRun, one EvalResult per case.

export const SUITE = 'retrieval';

export type CaseSelection = {
  split: EvalSplit;
  limit?: number;
  tags?: string[];
};

export type RunOptions = CaseSelection & {
  dataset: string;
  config: RetrievalConfig;
  // An earlier run of the same config: finished cases are kept, failed ones run again.
  resume?: string;
  log?: (line: string) => void;
};

export type StoredChunk = MatchableChunk & {
  chunkId: string;
  sourceId: string;
  scores?: ChunkScores;
  // Indexes of the expected refs this chunk hits.
  hits: number[];
};

export type StoredRetrieval = {
  ranked: StoredChunk[];
  debug: Omit<SearchDebug, 'ranked'> | null;
};

// What EvalResult.scores holds for a retrieval case.
export type StoredScores = Partial<RankingScores> & {
  answerable: boolean;
  weak: boolean;
  tainted: boolean;
};

/**
 * HEAD, or HEAD plus a hash of the uncommitted changes (tracked diff and untracked files), so
 * two different working trees never record the same version.
 */
export function codeVersion(
  head: string,
  diff: string,
  untracked: { path: string; content: Buffer }[],
) {
  if (!diff && untracked.length === 0) return head;
  const hash = createHash('sha256').update(diff);
  for (const file of untracked)
    hash.update('\0').update(file.path).update('\0').update(file.content);
  return `${head}-dirty-${hash.digest('hex').slice(0, 8)}`;
}

export function gitSha() {
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
      .split('\0')
      .filter(Boolean)
      .sort()
      .map((path) => ({ path, content: readFileSync(path) }));
    return codeVersion(git('rev-parse', 'HEAD').trim(), git('diff', 'HEAD'), untracked);
  } catch {
    return 'unknown';
  }
}

/** A hash of what the selected cases ask and expect, so a resume can tell they changed. */
export function casesHash(
  cases: Pick<EvalCase, 'externalId' | 'type' | 'question' | 'expectedRefs'>[],
) {
  const fields = cases.map(({ externalId, type, question, expectedRefs }) => ({
    externalId,
    type,
    question,
    expectedRefs,
  }));
  return createHash('sha256').update(canonical(fields)).digest('hex').slice(0, 16);
}

function withTimeout<T>(promise: Promise<T>, signal: AbortSignal, ms: number) {
  const timeout = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error(`Timed out after ${ms} ms`)), {
      once: true,
    });
  });
  return Promise.race([promise, timeout]);
}

/** JSON with object keys sorted, so a config read back from jsonb compares equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Why a run can't be resumed with this dataset, config, corpus and code, or null. Mixing
 * results measured under different settings would make the run's numbers meaningless.
 */
export function resumeConflict(
  run: { datasetId: string; config: unknown; gitSha: string; models: unknown },
  current: {
    datasetId: string;
    config: RetrievalConfig;
    corpusVersion: string;
    gitSha: string;
    casesHash: string;
    rerankerModel: string | null;
  },
) {
  const {
    selection: _,
    casesHash: storedCases,
    corpus,
    ...stored
  } = run.config as {
    selection?: unknown;
    casesHash?: string;
    corpus?: { corpusVersion?: string };
  };
  const { reranker = null } = (run.models ?? {}) as { reranker?: string | null };
  // The run stores the corpus it used in place of the config's variant; corpusVersion
  // covers the variant.
  const { corpus: _variant, ...config } = current.config;
  if (run.datasetId !== current.datasetId) return 'it ran on another dataset';
  if (canonical(stored) !== canonical(config)) return 'its config has changed since';
  if (corpus?.corpusVersion !== current.corpusVersion) return 'the corpus has changed since';
  if (storedCases !== current.casesHash) return 'its cases have changed since';
  if (reranker !== current.rerankerModel) {
    return `it reranked with ${reranker ?? 'no model'}, this would use ${current.rerankerModel ?? 'none'}`;
  }
  if (run.gitSha !== current.gitSha) {
    return `it ran on code ${run.gitSha}, this is ${current.gitSha}`;
  }
  return null;
}

async function usageCost(userId: string, from: Date, to: Date) {
  const { _sum } = await prismaClient.usageEvent.aggregate({
    where: { userId, createdAt: { gte: from, lte: to } },
    _sum: { costUsd: true },
  });
  return _sum.costUsd ?? new Prisma.Decimal(0);
}

/** The ranked chunks with what matching needs. Chunks cut by the threshold are read back. */
async function rankedChunks(
  result: SearchResult,
  workspaceId: string,
  sourceKeys: Map<string, string>,
): Promise<Omit<StoredChunk, 'hits'>[]> {
  const known = new Map(result.results.map((chunk) => [chunk.chunkId, chunk]));
  const missing = result.debug.ranked.filter((id) => !known.has(id));
  const rows =
    missing.length === 0
      ? []
      : await prismaClient.sourceChunk.findMany({
          where: { id: { in: missing }, workspaceId },
          select: {
            id: true,
            sourceId: true,
            headingPath: true,
            pageStart: true,
            pageEnd: true,
            lineStart: true,
            lineEnd: true,
            document: { select: { path: true } },
          },
        });
  const read = new Map(rows.map((row) => [row.id, row]));

  return result.debug.ranked.flatMap((id) => {
    const chunk = known.get(id);
    if (chunk) {
      return [
        {
          chunkId: id,
          sourceId: chunk.sourceId,
          sourceKey: sourceKeys.get(chunk.sourceId) ?? null,
          documentPath: chunk.documentPath,
          headingPath: chunk.headingPath,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          scores: chunk.scores,
        },
      ];
    }
    const row = read.get(id);
    if (!row) return [];
    return [
      {
        chunkId: id,
        sourceId: row.sourceId,
        sourceKey: sourceKeys.get(row.sourceId) ?? null,
        documentPath: row.document.path,
        headingPath: row.headingPath,
        pageStart: row.pageStart,
        pageEnd: row.pageEnd,
        lineStart: row.lineStart,
        lineEnd: row.lineEnd,
      },
    ];
  });
}

/** Rebuilds a case's outcome from its stored result, for summaries and reports. */
export function outcomeOf(
  result: Pick<EvalResult, 'scores' | 'retrieved' | 'latencyMs' | 'error'>,
  evalCase: Pick<EvalCase, 'type' | 'tags' | 'reviewed'>,
): CaseOutcome {
  const scores = result.scores as unknown as StoredScores;
  const retrieved = result.retrieved as unknown as StoredRetrieval;
  const answerable = evalCase.type !== 'NO_ANSWER';
  return {
    type: evalCase.type,
    tags: evalCase.tags,
    reviewed: evalCase.reviewed,
    answerable,
    scores:
      answerable && scores.recall5 !== undefined
        ? {
            recall5: scores.recall5,
            recall10: scores.recall10 ?? 0,
            hit5: scores.hit5 ?? 0,
            mrr: scores.mrr ?? 0,
            ndcg10: scores.ndcg10 ?? 0,
          }
        : undefined,
    weak: scores.weak ?? false,
    error: result.error !== null,
    tainted: scores.tainted ?? false,
    latencyMs: result.latencyMs,
    timings: { ...(retrieved.debug?.timings ?? {}) },
  };
}

export async function runSummary(runId: string) {
  const results = await prismaClient.evalResult.findMany({
    where: { runId },
    include: { case: { select: { type: true, tags: true, reviewed: true } } },
  });
  return summarize(results.map((result) => outcomeOf(result, result.case)));
}

export async function runRetrieval(options: RunOptions) {
  const { config, log = () => {} } = options;
  const dataset = await prismaClient.evalDataset.findUnique({ where: { name: options.dataset } });
  if (!dataset) throw new Error(`No dataset "${options.dataset}": run pnpm evals:import first`);

  const corpus = await loadCorpus(options.dataset, config.corpus);
  const notReady = corpus.sources.filter((source) => source.status !== 'READY');
  if (notReady.length > 0) {
    const list = notReady.map((source) => `${source.sourceKey} (${source.status})`).join(', ');
    throw new Error(`Corpus sources not ready: ${list}. Run pnpm evals:corpus first`);
  }
  const sourceKeys = new Map(corpus.sources.map((source) => [source.sourceId, source.sourceKey]));

  const queryMode = config.search.queryMode;
  const modelOverride = queryMode === 'none' ? undefined : textRoutes.rewrite.primary;
  const rerankerModel = config.search.rerank
    ? (config.search.rerankerModel ?? serverConfig.RERANKER_MODEL)
    : null;

  let selection: CaseSelection = { split: options.split, limit: options.limit, tags: options.tags };
  const resumed = options.resume
    ? await prismaClient.evalRun.findUnique({ where: { id: options.resume } })
    : null;
  if (options.resume) {
    if (!resumed || resumed.suite !== SUITE || resumed.name !== config.name) {
      throw new Error(`Run ${options.resume} is not a ${SUITE} run of ${config.name}`);
    }
    selection = (resumed.config as { selection: CaseSelection }).selection;
  }
  const cases = await prismaClient.evalCase.findMany({
    where: {
      datasetId: dataset.id,
      retired: false,
      split: selection.split,
      ...(selection.tags?.length ? { tags: { hasSome: selection.tags } } : {}),
      ...(config.caseTypes ? { type: { in: config.caseTypes } } : {}),
    },
    orderBy: { externalId: 'asc' },
    ...(selection.limit ? { take: selection.limit } : {}),
  });
  const selectedHash = casesHash(cases);
  const sha = gitSha();

  let runId: string;
  if (resumed) {
    const conflict = resumeConflict(resumed, {
      datasetId: dataset.id,
      config,
      corpusVersion: corpus.corpusVersion,
      gitSha: sha,
      casesHash: selectedHash,
      rerankerModel,
    });
    if (conflict) {
      throw new Error(`Can't resume run ${resumed.id}: ${conflict}. Start a new run instead`);
    }
    await prismaClient.evalResult.deleteMany({
      where: { runId: resumed.id, error: { not: null } },
    });
    await prismaClient.evalRun.update({
      where: { id: resumed.id },
      data: { status: 'RUNNING', finishedAt: null },
    });
    runId = resumed.id;
  } else {
    const run = await prismaClient.evalRun.create({
      data: {
        datasetId: dataset.id,
        suite: SUITE,
        name: config.name,
        config: {
          ...config,
          selection,
          casesHash: selectedHash,
          corpus: {
            variant: config.corpus,
            workspaceId: corpus.workspaceId,
            corpusVersion: corpus.corpusVersion,
            sources: corpus.sources,
          },
        } as Prisma.InputJsonValue,
        gitSha: sha,
        promptVersions: prompts.map((prompt) => prompt.id),
        models: {
          embedding: embeddingRoute.model,
          reranker: rerankerModel,
          queryMode: modelOverride ?? null,
        },
        split: selection.split,
      },
    });
    runId = run.id;
  }

  let segmentStart = new Date();
  try {
    const done = await prismaClient.evalResult.findMany({
      where: { runId },
      select: { caseId: true },
    });
    const doneIds = new Set(done.map((row) => row.caseId));
    const todo = cases.filter((evalCase) => !doneIds.has(evalCase.id));
    log(`${config.name}: run ${runId}, ${todo.length} of ${cases.length} cases to run`);

    // Embed every question up front, so no config's latency or cost includes the first,
    // uncached embedding of a question: every config of a matrix measures the same thing.
    if (config.search.mode !== 'keyword' && todo.length > 0) {
      try {
        await embedTexts(
          todo.map((evalCase) => evalCase.question),
          { kind: 'query', ctx: { userId: corpus.userId, workspaceId: corpus.workspaceId } },
        );
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        log(`  Couldn't embed the questions ahead (${message}); cases embed their own`);
      }
      segmentStart = new Date();
    }

    // One case at a time: two at once would share the CPU (the reranker), latency would stop
    // comparing across configs, and usage rows couldn't be told apart for the cost. Query
    // modes are also spaced under the model's rate limit.
    const pace = config.gapMs > 0 ? createPacer(config.gapMs) : null;
    let finished = 0;

    for (const evalCase of todo) {
      await pace?.();
      const refs = expectedRefSchema.array().parse(evalCase.expectedRefs);
      const answerable = evalCase.type !== 'NO_ANSWER';
      const started = new Date();
      const startedAt = performance.now();
      const signal = AbortSignal.timeout(config.timeoutMs);

      let retrieved: StoredRetrieval = { ranked: [], debug: null };
      let scores: StoredScores = { answerable, weak: false, tainted: false };
      let error: string | null = null;
      const searching = search({
        userId: corpus.userId,
        workspaceId: corpus.workspaceId,
        query: evalCase.question,
        mode: config.search.mode,
        queryMode,
        rerank: config.search.rerank,
        rerankerModel: config.search.rerankerModel,
        topK: config.search.topK,
        expandParents: false,
        modelOverride,
        signal,
      });
      try {
        const result = await withTimeout(searching, signal, config.timeoutMs);
        const chunks = await rankedChunks(result, corpus.workspaceId, sourceKeys);
        const hits = refHits(chunks, refs);
        const { ranked: _, ...debug } = result.debug;
        retrieved = { ranked: chunks.map((chunk, i) => ({ ...chunk, hits: hits[i]! })), debug };
        scores = {
          ...(answerable ? scoreRanking(hits, refs.length) : {}),
          answerable,
          weak: result.debug.weak,
          tainted:
            (config.search.rerank && result.debug.rerank === 'unavailable') ||
            result.debug.queryModeError !== undefined ||
            result.debug.fallbackUsed,
        };
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      // A timed-out search keeps going until its next abort check; let it end, so it neither
      // overlaps the next case nor puts its usage rows in that case's cost window.
      await searching.catch(() => {});
      const latencyMs = Math.round(performance.now() - startedAt);
      const costUsd = await usageCost(corpus.userId, started, new Date());

      await prismaClient.evalResult.create({
        data: {
          runId,
          caseId: evalCase.id,
          retrieved: retrieved as unknown as Prisma.InputJsonValue,
          scores: scores as Prisma.InputJsonValue,
          latencyMs,
          costUsd,
          error,
        },
      });

      finished += 1;
      const outcome = error
        ? `error: ${error}`
        : answerable
          ? `recall@5 ${(scores.recall5 ?? 0).toFixed(2)}`
          : `weak ${scores.weak}`;
      log(`  ${finished}/${todo.length} ${evalCase.externalId} ${outcome} (${latencyMs} ms)`);
    }

    const summary = await runSummary(runId);
    const segmentCost = await usageCost(corpus.userId, segmentStart, new Date());
    await prismaClient.evalRun.update({
      where: { id: runId },
      data: {
        status: 'DONE',
        finishedAt: new Date(),
        summary: summary as unknown as Prisma.InputJsonValue,
        costUsd: { increment: segmentCost },
      },
    });
    return { runId, summary };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await prismaClient.evalRun.update({
      where: { id: runId },
      data: { status: 'FAILED', finishedAt: new Date(), notes: message },
    });
    throw caught;
  }
}
