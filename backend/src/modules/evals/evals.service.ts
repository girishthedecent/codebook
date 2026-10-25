import { inngest } from '../../config/inngest.config.js';
import { evalRunRequested } from '../../inngest/events.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors/app.error.js';
import type { CompareQuery, CreateRunInput, ListRunsQuery, ResultsQuery } from './evals.dto.js';
import {
  countResults,
  findResults,
  findRun,
  isStale,
  listDatasets,
  listRuns,
  runningRuns,
  type ResultRow,
} from './evals.repository.js';

// Eval runs, read for the admin dashboard. Results show refs and scores, never the text of
// the passages a model was shown: corpora can be copyrighted books.

type Scores = Record<string, unknown>;
type RunRow = Awaited<ReturnType<typeof listRuns>>[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown) => (typeof value === 'number' ? value : null);

function runItem(run: RunRow) {
  const summary = isRecord(run.summary) ? run.summary : null;
  return {
    id: run.id,
    dataset: run.dataset.name,
    suite: run.suite,
    name: run.name,
    split: run.split,
    status: run.status,
    gitSha: run.gitSha,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    costUsd: run.costUsd.toString(),
    // Every suite's summary has `overall`; the rest of it differs by suite.
    overall: summary && isRecord(summary.overall) ? summary.overall : null,
    notes: run.notes,
  };
}

export async function listDatasetsService() {
  const { datasets, counts } = await listDatasets();
  return datasets.map((dataset) => {
    const rows = counts.filter((row) => row.datasetId === dataset.id);
    const tally = (key: 'split' | 'type') =>
      rows.reduce<Record<string, number>>((acc, row) => {
        acc[row[key]] = (acc[row[key]] ?? 0) + row._count._all;
        return acc;
      }, {});
    return {
      ...dataset,
      cases: rows.reduce((sum, row) => sum + row._count._all, 0),
      bySplit: tally('split'),
      byType: tally('type'),
    };
  });
}

export async function listRunsService(query: ListRunsQuery) {
  return (await listRuns(query)).map(runItem);
}

async function loadRun(runId: string) {
  const run = await findRun(runId);
  if (!run) throw new NotFoundError('Eval run not found');
  return run;
}

export async function getRunService(runId: string) {
  const run = await loadRun(runId);
  return {
    ...runItem(run),
    config: run.config,
    promptVersions: run.promptVersions,
    models: run.models,
    summary: run.summary,
    counts: await countResults(runId),
  };
}

/**
 * One number per case for diffs and the failed filter, 0 to 1: recall@5 for retrieval,
 * correctness for answers, and for no-answer cases whether the run noticed. Null when the
 * case wasn't scored on it.
 */
export function caseScore(suite: string, type: string, scores: Scores) {
  const noAnswer = type === 'NO_ANSWER';
  if (suite === 'retrieval') {
    if (noAnswer) return scores.weak === true ? 1 : 0;
    return num(scores.recall5) ?? 0;
  }
  if (suite === 'answer') {
    if (noAnswer) {
      return typeof scores.noAnswerCorrect === 'boolean' ? Number(scores.noAnswerCorrect) : null;
    }
    return num(scores.correctness);
  }
  return null;
}

export function isFailed(suite: string, type: string, scores: Scores, error: string | null) {
  if (error !== null) return true;
  const score = caseScore(suite, type, scores);
  if (score !== null && score < 1) return true;
  // An answer can be right and still claim things its passages don't say.
  const faithfulness = num(scores.faithfulness);
  return suite === 'answer' && faithfulness !== null && faithfulness < 1;
}

function withoutPassageText(retrieved: unknown) {
  if (!isRecord(retrieved) || !Array.isArray(retrieved.passages)) return retrieved;
  return {
    ...retrieved,
    passages: retrieved.passages.map((passage: unknown) => {
      if (!isRecord(passage)) return passage;
      const { text: _, ...rest } = passage;
      return rest;
    }),
  };
}

function withoutSnippets(citations: unknown) {
  if (!Array.isArray(citations)) return citations;
  return citations.map((citation: unknown) => {
    if (!isRecord(citation)) return citation;
    const { snippet: _, text: __, ...rest } = citation;
    return rest;
  });
}

function resultItem(suite: string, row: ResultRow) {
  const scores = isRecord(row.scores) ? row.scores : {};
  return {
    id: row.id,
    caseId: row.caseId,
    ...row.case,
    failed: isFailed(suite, row.case.type, scores, row.error),
    score: caseScore(suite, row.case.type, scores),
    scores,
    error: row.error,
    answer: row.answer,
    citations: withoutSnippets(row.citations),
    retrieved: withoutPassageText(row.retrieved),
    toolTrajectory: row.toolTrajectory,
    latencyMs: row.latencyMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd.toString(),
  };
}

export async function listResultsService(runId: string, query: ResultsQuery) {
  const run = await loadRun(runId);
  const items = (await findResults(runId, query.type)).map((row) => resultItem(run.suite, row));
  return query.failed ? items.filter((item) => item.failed) : items;
}

type Delta = { a: number | null; b: number | null; delta: number | null };

/** Every number in two metric objects, side by side. */
export function metricDeltas(a: unknown, b: unknown): Record<string, Delta> {
  const left = isRecord(a) ? a : {};
  const right = isRecord(b) ? b : {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
    (key) => num(left[key]) !== null || num(right[key]) !== null,
  );
  return Object.fromEntries(
    keys.map((key) => {
      const x = num(left[key]);
      const y = num(right[key]);
      return [key, { a: x, b: y, delta: x === null || y === null ? null : y - x }];
    }),
  );
}

type CaseSide = { score: number | null; error: string | null };

function changeOf(a: CaseSide | undefined, b: CaseSide | undefined) {
  if (!a) return 'only-b';
  if (!b) return 'only-a';
  if (a.error && !b.error) return 'fixed';
  if (!a.error && b.error) return 'broke';
  if (a.score === null || b.score === null || a.score === b.score) return 'same';
  return b.score > a.score ? 'better' : 'worse';
}

const CHANGE_ORDER = ['broke', 'worse', 'only-a', 'only-b', 'better', 'fixed', 'same'];

/**
 * Two runs of one suite on one dataset: overall and per-type metric deltas (b − a), and the
 * cases whose score changed, worst news first.
 */
export async function compareRunsService({ runs: [idA, idB] }: CompareQuery) {
  const [a, b] = await Promise.all([loadRun(idA!), loadRun(idB!)]);
  if (a.suite !== b.suite) {
    throw new BadRequestError(`Can't compare a ${a.suite} run with a ${b.suite} run`);
  }
  if (a.datasetId !== b.datasetId) {
    throw new BadRequestError('The two runs are on different datasets');
  }

  const summaryA = isRecord(a.summary) ? a.summary : {};
  const summaryB = isRecord(b.summary) ? b.summary : {};
  const typesA = isRecord(summaryA.byType) ? summaryA.byType : {};
  const typesB = isRecord(summaryB.byType) ? summaryB.byType : {};
  const types = [...new Set([...Object.keys(typesA), ...Object.keys(typesB)])].sort();

  const [rowsA, rowsB] = await Promise.all([findResults(a.id), findResults(b.id)]);
  const side = (row: ResultRow): CaseSide => ({
    score: caseScore(a.suite, row.case.type, isRecord(row.scores) ? row.scores : {}),
    error: row.error,
  });
  const byCase = new Map<string, { row: ResultRow; a?: CaseSide; b?: CaseSide }>();
  for (const row of rowsA) byCase.set(row.caseId, { row, a: side(row) });
  for (const row of rowsB) {
    const entry = byCase.get(row.caseId);
    if (entry) entry.b = side(row);
    else byCase.set(row.caseId, { row, b: side(row) });
  }

  const cases = [...byCase.values()].map(({ row, a: left, b: right }) => ({
    caseId: row.caseId,
    externalId: row.case.externalId,
    type: row.case.type,
    question: row.case.question,
    a: left ?? null,
    b: right ?? null,
    change: changeOf(left, right),
  }));
  const counts = Object.fromEntries(
    CHANGE_ORDER.map((change) => [change, cases.filter((item) => item.change === change).length]),
  );

  return {
    suite: a.suite,
    runs: { a: runItem(a), b: runItem(b) },
    overall: metricDeltas(summaryA.overall, summaryB.overall),
    byType: Object.fromEntries(
      types.map((type) => [type, metricDeltas(typesA[type], typesB[type])]),
    ),
    counts,
    cases: cases
      .filter((item) => item.change !== 'same')
      .sort(
        (x, y) =>
          CHANGE_ORDER.indexOf(x.change) - CHANGE_ORDER.indexOf(y.change) ||
          x.externalId.localeCompare(y.externalId),
      ),
  };
}

/**
 * Queues a run for the eval worker, which checks the names and owns the run from there.
 * Runs go one at a time (they share the free-tier quotas), so a request while one is still
 * going is refused here rather than dropped by the worker.
 */
export async function requestRunService(input: CreateRunInput, requestedBy: string) {
  const now = new Date();
  const active = (await runningRuns()).find((run) => !isStale(run, now));
  if (active) {
    throw new ConflictError(
      `Eval run ${active.id} (${active.suite} ${active.name}) is still running; try again when it ends`,
    );
  }
  await inngest.send(evalRunRequested.create({ ...input, requestedBy }));
  return { ...input, status: 'queued' as const };
}
