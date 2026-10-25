import prismaClient from '../../config/db.config.js';
import type { EvalCaseType } from '../../generated/prisma/enums.js';

const RUN_FIELDS = {
  id: true,
  suite: true,
  name: true,
  split: true,
  status: true,
  gitSha: true,
  startedAt: true,
  finishedAt: true,
  costUsd: true,
  summary: true,
  notes: true,
  dataset: { select: { name: true } },
} as const;

export async function listDatasets() {
  const [datasets, counts] = await Promise.all([
    prismaClient.evalDataset.findMany({
      select: { id: true, name: true, description: true, createdAt: true },
      orderBy: { name: 'asc' },
    }),
    prismaClient.evalCase.groupBy({
      by: ['datasetId', 'split', 'type'],
      where: { retired: false },
      _count: { _all: true },
    }),
  ]);
  return { datasets, counts };
}

export function listRuns(filter: { suite?: string; dataset?: string; limit: number }) {
  return prismaClient.evalRun.findMany({
    where: {
      ...(filter.suite ? { suite: filter.suite } : {}),
      ...(filter.dataset ? { dataset: { name: filter.dataset } } : {}),
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: filter.limit,
    select: RUN_FIELDS,
  });
}

export function findRun(runId: string) {
  return prismaClient.evalRun.findUnique({
    where: { id: runId },
    select: {
      ...RUN_FIELDS,
      datasetId: true,
      config: true,
      promptVersions: true,
      models: true,
    },
  });
}

export async function countResults(runId: string) {
  const [results, errors] = await Promise.all([
    prismaClient.evalResult.count({ where: { runId } }),
    prismaClient.evalResult.count({ where: { runId, error: { not: null } } }),
  ]);
  return { results, errors };
}

/** A run's results with their cases, in case order. A run has at most a few hundred. */
export function findResults(runId: string, type?: EvalCaseType) {
  return prismaClient.evalResult.findMany({
    where: { runId, ...(type ? { case: { type } } : {}) },
    orderBy: { case: { externalId: 'asc' } },
    select: {
      id: true,
      caseId: true,
      retrieved: true,
      answer: true,
      citations: true,
      toolTrajectory: true,
      scores: true,
      latencyMs: true,
      tokensIn: true,
      tokensOut: true,
      costUsd: true,
      error: true,
      case: {
        select: {
          externalId: true,
          type: true,
          split: true,
          question: true,
          expectedAnswer: true,
          expectedRefs: true,
          tags: true,
          reviewed: true,
          origin: true,
        },
      },
    },
  });
}

export type ResultRow = Awaited<ReturnType<typeof findResults>>[number];

// A RUNNING run with no new result for this long is taken as dead: the worker or the CLI
// running it stopped without marking it. Generous, since one answer case with its gap and
// retries stays within a few minutes.
export const RUN_STALE_AFTER_MS = 30 * 60_000;

/** RUNNING runs and when they last showed progress (a stored result, or the start). */
export async function runningRuns() {
  const runs = await prismaClient.evalRun.findMany({
    where: { status: 'RUNNING' },
    select: {
      id: true,
      suite: true,
      name: true,
      startedAt: true,
      results: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  return runs.map((run) => {
    const lastResult = run.results[0]?.createdAt;
    return {
      id: run.id,
      suite: run.suite,
      name: run.name,
      lastActivity: lastResult && lastResult > run.startedAt ? lastResult : run.startedAt,
    };
  });
}

export type RunningRun = Awaited<ReturnType<typeof runningRuns>>[number];

export const isStale = (run: RunningRun, now: Date) =>
  now.getTime() - run.lastActivity.getTime() >= RUN_STALE_AFTER_MS;
