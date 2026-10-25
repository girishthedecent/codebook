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
import { configNames, loadConfig, retrievalConfigSchema, type RetrievalConfig } from './config.js';
import { loadCorpus, type Corpus, type CorpusVariant } from './corpusWorkspace.js';
import { expectedRefSchema } from './dataset.js';
import { refHits, type MatchableChunk } from './matching.js';
import { canonical, casesHash, errorMessage, gitSha, usageCost, withTimeout } from './runUtils.js';
import {
  scoreRanking,
  summarize,
  type CaseOutcome,
  type RankingScores,
} from './scorers/retrieval.js';
import type { EvalSuite, StartedRun } from './suite.types.js';

export { casesHash, codeVersion, gitSha } from './runUtils.js';

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

// What a case needs from its run. Kept per process; a worker step in another process reads
// it back from the run.
type RetrievalRun = {
  runId: string;
  config: RetrievalConfig;
  corpus: Corpus;
  sourceKeys: Map<string, string>;
  modelOverride: (typeof textRoutes)['rewrite']['primary'] | undefined;
};

const openRuns = new Map<string, RetrievalRun>();

function runSettings(config: RetrievalConfig) {
  const queryMode = config.search.queryMode;
  return {
    modelOverride: queryMode === 'none' ? undefined : textRoutes.rewrite.primary,
    rerankerModel: config.search.rerank
      ? (config.search.rerankerModel ?? serverConfig.RERANKER_MODEL)
      : null,
  };
}

function remember(runId: string, config: RetrievalConfig, corpus: Corpus) {
  const run: RetrievalRun = {
    runId,
    config,
    corpus,
    sourceKeys: new Map(corpus.sources.map((source) => [source.sourceId, source.sourceKey])),
    modelOverride: runSettings(config).modelOverride,
  };
  openRuns.set(runId, run);
  return run;
}

/**
 * Creates the run (or reopens one to resume) and returns the cases still to run. Every
 * question is embedded up front, so no config's latency or cost includes the first,
 * uncached embedding of a question: every config of a matrix measures the same thing.
 */
export async function startRetrieval(options: RunOptions): Promise<StartedRun> {
  const { config, log = () => {} } = options;
  const dataset = await prismaClient.evalDataset.findUnique({ where: { name: options.dataset } });
  if (!dataset) throw new Error(`No dataset "${options.dataset}": run pnpm evals:import first`);

  const corpus = await loadCorpus(options.dataset, config.corpus);
  const notReady = corpus.sources.filter((source) => source.status !== 'READY');
  if (notReady.length > 0) {
    const list = notReady.map((source) => `${source.sourceKey} (${source.status})`).join(', ');
    throw new Error(`Corpus sources not ready: ${list}. Run pnpm evals:corpus first`);
  }
  const { modelOverride, rerankerModel } = runSettings(config);

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
  remember(runId, config, corpus);

  try {
    const done = await prismaClient.evalResult.findMany({
      where: { runId },
      select: { caseId: true },
    });
    const doneIds = new Set(done.map((row) => row.caseId));
    const todo = cases.filter((evalCase) => !doneIds.has(evalCase.id));
    log(`${config.name}: run ${runId}, ${todo.length} of ${cases.length} cases to run`);

    if (config.search.mode !== 'keyword' && todo.length > 0) {
      try {
        await embedTexts(
          todo.map((evalCase) => evalCase.question),
          { kind: 'query', ctx: { userId: corpus.userId, workspaceId: corpus.workspaceId } },
        );
      } catch (caught) {
        log(
          `  Couldn't embed the questions ahead (${errorMessage(caught)}); cases embed their own`,
        );
      }
    }
    return { runId, caseIds: todo.map((evalCase) => evalCase.id), gapMs: config.gapMs };
  } catch (caught) {
    await failRetrieval(runId, errorMessage(caught));
    throw caught;
  }
}

/** The run's config and corpus, read back from the run when this process didn't start it. */
async function openRun(runId: string): Promise<RetrievalRun> {
  const known = openRuns.get(runId);
  if (known) return known;
  const run = await prismaClient.evalRun.findUnique({
    where: { id: runId },
    include: { dataset: { select: { name: true } } },
  });
  if (!run || run.suite !== SUITE) throw new Error(`No ${SUITE} run ${runId}`);
  const {
    selection: _selection,
    casesHash: _cases,
    corpus,
    ...stored
  } = run.config as { selection?: unknown; casesHash?: unknown; corpus: StoredCorpus };
  const config = retrievalConfigSchema.parse({ ...stored, corpus: corpus.variant });
  // A worker that picked up new code halfway would mix two versions in one run.
  const sha = gitSha();
  if (run.gitSha !== sha) throw new Error(`Run ${runId} ran on code ${run.gitSha}, this is ${sha}`);
  const current = await loadCorpus(run.dataset.name, corpus.variant);
  if (current.corpusVersion !== corpus.corpusVersion) {
    throw new Error(`The corpus of run ${runId} has changed since it started`);
  }
  return remember(runId, config, current);
}

type StoredCorpus = { variant: CorpusVariant; corpusVersion: string };

/** Searches one case and stores its result; the run's cost grows by what the case spent. */
export async function runRetrievalCase(runId: string, caseId: string) {
  const { config, corpus, sourceKeys, modelOverride } = await openRun(runId);
  const evalCase = await prismaClient.evalCase.findUniqueOrThrow({ where: { id: caseId } });
  const stored = await prismaClient.evalResult.findUnique({
    where: { runId_caseId: { runId, caseId } },
  });
  if (stored && stored.error === null) return { line: `${evalCase.externalId} already done` };
  if (stored) await prismaClient.evalResult.delete({ where: { id: stored.id } });

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
    queryMode: config.search.queryMode,
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
    error = errorMessage(caught);
  }
  // A timed-out search keeps going until its next abort check; let it end, so it neither
  // overlaps the next case nor puts its usage rows in that case's cost window.
  await searching.catch(() => {});
  const latencyMs = Math.round(performance.now() - startedAt);
  const costUsd = await usageCost(corpus.userId, started, new Date());

  await prismaClient.$transaction([
    prismaClient.evalResult.create({
      data: {
        runId,
        caseId: evalCase.id,
        retrieved: retrieved as unknown as Prisma.InputJsonValue,
        scores: scores as Prisma.InputJsonValue,
        latencyMs,
        costUsd,
        error,
      },
    }),
    prismaClient.evalRun.update({
      where: { id: runId },
      data: { costUsd: { increment: costUsd } },
    }),
  ]);

  const outcome = error
    ? `error: ${error}`
    : answerable
      ? `recall@5 ${(scores.recall5 ?? 0).toFixed(2)}`
      : `weak ${scores.weak}`;
  return { line: `${evalCase.externalId} ${outcome} (${latencyMs} ms)` };
}

export async function finishRetrieval(runId: string) {
  const summary = await runSummary(runId);
  await prismaClient.evalRun.update({
    where: { id: runId },
    data: {
      status: 'DONE',
      finishedAt: new Date(),
      summary: summary as unknown as Prisma.InputJsonValue,
    },
  });
  openRuns.delete(runId);
  return summary;
}

export async function failRetrieval(runId: string, message: string) {
  openRuns.delete(runId);
  await prismaClient.evalRun.update({
    where: { id: runId },
    data: { status: 'FAILED', finishedAt: new Date(), notes: message },
  });
}

/**
 * Runs a config over the selected cases in this process, one case at a time: two at once
 * would share the CPU (the reranker), latency would stop comparing across configs, and
 * usage rows couldn't be told apart for the cost. Query modes are also spaced under the
 * model's rate limit.
 */
export async function runRetrieval(options: RunOptions) {
  const { log = () => {} } = options;
  const { runId, caseIds, gapMs } = await startRetrieval(options);
  try {
    const pace = gapMs > 0 ? createPacer(gapMs) : null;
    for (const [i, caseId] of caseIds.entries()) {
      await pace?.();
      const { line } = await runRetrievalCase(runId, caseId);
      log(`  ${i + 1}/${caseIds.length} ${line}`);
    }
    return { runId, summary: await finishRetrieval(runId) };
  } catch (caught) {
    await failRetrieval(runId, errorMessage(caught));
    throw caught;
  }
}

export const retrievalSuite: EvalSuite = {
  suite: SUITE,
  configNames: () => configNames(),
  async start(options) {
    const config = await loadConfig(options.config);
    return startRetrieval({ ...options, config });
  },
  runCase: runRetrievalCase,
  finish: async (runId) => {
    await finishRetrieval(runId);
  },
  fail: failRetrieval,
};
