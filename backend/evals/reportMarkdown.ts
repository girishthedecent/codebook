import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import prismaClient from '../src/config/db.config.js';
import type { EvalCase, EvalResult, EvalRun } from '../src/generated/prisma/client.js';
import type { EvalSplit } from '../src/generated/prisma/enums.js';
import type { RetrievalConfig } from './config.js';
import { expectedRefSchema, type ExpectedRef } from './dataset.js';
import type {
  CaseSelection,
  StoredChunk,
  StoredRetrieval,
  StoredScores,
} from './retrievalSuite.js';
import { outcomeOf, SUITE } from './retrievalSuite.js';
import { metricsOf, summarize, type CaseOutcome, type Metrics } from './scorers/retrieval.js';

// Renders retrieval runs as a Markdown report.

export const REPORT_DIR = 'evals/reports';

export type ReportRun = EvalRun & {
  results: (EvalResult & { case: EvalCase })[];
};

const CASE_TYPES = ['BOOK', 'CODE', 'MULTI_HOP', 'CROSS_SOURCE', 'NO_ANSWER'] as const;

export const fixed = (value: number | null) => (value === null ? '–' : value.toFixed(3));
export const ms = (value: number) => `${Math.round(value)} ms`;
// Markdown table cells can't hold pipes or line breaks.
export const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function table(head: string[], rows: string[][]) {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function formatRef(ref: ExpectedRef) {
  switch (ref.sourceKey) {
    case 'book':
      return ref.pageStart === ref.pageEnd
        ? `book p. ${ref.pageStart}`
        : `book pp. ${ref.pageStart}–${ref.pageEnd}`;
    case 'repo':
      return `${ref.path}:${ref.lineStart}–${ref.lineEnd}`;
    case 'docs':
      return ref.heading ? `${ref.url} § ${ref.heading}` : ref.url;
  }
}

function formatChunk(chunk: StoredChunk) {
  const mark = chunk.hits.length > 0 ? ' ✓' : '';
  if (chunk.pageStart !== null) {
    const pages =
      chunk.pageEnd !== null && chunk.pageEnd !== chunk.pageStart
        ? `pp. ${chunk.pageStart}–${chunk.pageEnd}`
        : `p. ${chunk.pageStart}`;
    return `${chunk.sourceKey ?? '?'} ${pages}${mark}`;
  }
  if (chunk.lineStart !== null) {
    return `${chunk.documentPath}:${chunk.lineStart}–${chunk.lineEnd ?? chunk.lineStart}${mark}`;
  }
  const heading = chunk.headingPath.at(-1);
  return `${chunk.documentPath}${heading ? ` § ${heading}` : ''}${mark}`;
}

function outcomesOf(run: ReportRun) {
  return run.results.map((result) => ({ result, outcome: outcomeOf(result, result.case) }));
}

function mainRow(run: ReportRun, outcomes: CaseOutcome[], costUsd = Number(run.costUsd)) {
  const summary = summarize(outcomes);
  const m = summary.overall;
  const tainted = summary.taintedCases > 0 ? `yes (${summary.taintedCases})` : 'no';
  return [
    run.name,
    String(m.cases),
    fixed(m.recall5),
    fixed(m.recall10),
    fixed(m.mrr),
    fixed(m.ndcg10),
    fixed(m.noAnswerAccuracy),
    fixed(m.falseWeakRate),
    ms(summary.latency.p50),
    ms(summary.latency.p95),
    `$${costUsd.toFixed(4)}`,
    m.errors > 0 ? `${tainted}, ${m.errors} errors` : tainted,
  ];
}

const typeCell = (metrics: Metrics | undefined, type: string) => {
  if (!metrics) return '–';
  return type === 'NO_ANSWER'
    ? `${fixed(metrics.noAnswerAccuracy)} (${metrics.cases})`
    : `${fixed(metrics.recall5)} (${metrics.cases})`;
};

/** The case types a config was limited to, e.g. the corpus without contexts. */
const caseTypesOf = (run: ReportRun) => (run.config as Partial<RetrievalConfig>).caseTypes;

function worstCases(run: ReportRun, count: number) {
  return outcomesOf(run)
    .map(({ result, outcome }) => {
      const scores = result.scores as unknown as StoredScores;
      // Errors first, then failed no-answer cases, then the lowest recall and MRR.
      const badness = outcome.error
        ? 3
        : !outcome.answerable
          ? outcome.weak
            ? -1
            : 2
          : 1 - (scores.recall5 ?? 0) + (1 - (scores.mrr ?? 0)) / 10;
      return { result, outcome, badness };
    })
    .filter(({ badness }) => badness > 0)
    .sort(
      (a, b) =>
        b.badness - a.badness || a.result.case.externalId.localeCompare(b.result.case.externalId),
    )
    .slice(0, count);
}

export function renderReport(runs: ReportRun[], date = new Date()) {
  const lines: string[] = [];
  const day = date.toISOString().slice(0, 10);
  lines.push(`# Retrieval evals, ${day}`, '');

  if (runs.length === 0) {
    lines.push('No finished runs.', '');
    return lines.join('\n');
  }

  const shas = [...new Set(runs.map((run) => run.gitSha))].join(', ');
  const splits = [...new Set(runs.map((run) => run.split))].join(', ');
  lines.push(
    `Split ${splits} · code ${shas} · ${runs.length} runs. Recall and MRR are on the ranking ` +
      'before the score threshold; NO_ANSWER cases count only toward no-answer accuracy. ' +
      'False-weak is the share of answerable cases the search called weak. A tainted run had ' +
      'cases where the reranker or a query mode fell back, so it measured something else. ' +
      'Cases run one at a time with every question embedded beforehand, so latency compares ' +
      'across configs; it and the cost leave out that first embedding.',
    '',
  );

  lines.push('## Results', '');
  lines.push(
    table(
      [
        'Config',
        'Cases',
        'Recall@5',
        'Recall@10',
        'MRR',
        'nDCG@10',
        'No-answer',
        'False-weak',
        'p50',
        'p95',
        'Cost',
        'Tainted',
      ],
      runs.map((run) =>
        mainRow(
          run,
          outcomesOf(run).map(({ outcome }) => outcome),
        ),
      ),
    ),
    '',
  );

  // A config limited to some case types (no book in its corpus) is compared with the
  // other runs on those types only.
  for (const run of runs) {
    const types = caseTypesOf(run);
    if (!types) continue;
    const peers = runs.filter((other) => other !== run && !caseTypesOf(other));
    if (peers.length === 0) continue;
    lines.push(`### On ${types.join(', ')} only (to compare with ${run.name})`, '');
    lines.push(
      table(
        [
          'Config',
          'Cases',
          'Recall@5',
          'Recall@10',
          'MRR',
          'nDCG@10',
          'No-answer',
          'False-weak',
          'p50',
          'p95',
          'Cost',
          'Tainted',
        ],
        [run, ...peers].map((other) => {
          const kept = outcomesOf(other).filter(({ outcome }) =>
            (types as string[]).includes(outcome.type),
          );
          const cost = kept.reduce((sum, { result }) => sum + Number(result.costUsd ?? 0), 0);
          return mainRow(
            other,
            kept.map(({ outcome }) => outcome),
            cost,
          );
        }),
      ),
      '',
    );
  }

  lines.push('## By case type', '', 'Recall@5 (cases); no-answer accuracy for NO_ANSWER.', '');
  lines.push(
    table(
      ['Config', ...CASE_TYPES],
      runs.map((run) => {
        const outcomes = outcomesOf(run).map(({ outcome }) => outcome);
        return [
          run.name,
          ...CASE_TYPES.map((type) => {
            const group = outcomes.filter((outcome) => outcome.type === type);
            return typeCell(group.length > 0 ? metricsOf(group) : undefined, type);
          }),
        ];
      }),
    ),
    '',
  );

  lines.push('## Reviewed and unreviewed cases', '', 'Recall@5 (cases).', '');
  lines.push(
    table(
      ['Config', 'Reviewed', 'Unreviewed'],
      runs.map((run) => {
        const outcomes = outcomesOf(run).map(({ outcome }) => outcome);
        const cellFor = (reviewed: boolean) => {
          const group = outcomes.filter(
            (outcome) => outcome.reviewed === reviewed && outcome.answerable,
          );
          return group.length > 0 ? `${fixed(metricsOf(group).recall5)} (${group.length})` : '–';
        };
        return [run.name, cellFor(true), cellFor(false)];
      }),
    ),
    '',
  );

  // Worst cases of the best run: what's left to fix where retrieval is already at its best.
  const best =
    [...runs].filter((run) => !caseTypesOf(run)).sort((a, b) => metricOf(b) - metricOf(a))[0] ??
    runs[0]!;
  const worst = worstCases(best, 10);
  lines.push(`## Worst cases of ${best.name}`, '');
  if (worst.length === 0) {
    lines.push('None.', '');
  } else {
    lines.push(
      table(
        ['Case', 'Question', 'Expected', 'Top 3 retrieved'],
        worst.map(({ result }) => {
          const refs = expectedRefSchema.array().parse(result.case.expectedRefs);
          const retrieved = result.retrieved as unknown as StoredRetrieval;
          const top = result.error
            ? `error: ${result.error}`
            : retrieved.ranked.slice(0, 3).map(formatChunk).join('<br>') || 'nothing';
          return [
            `${result.case.externalId} (${result.case.type})`,
            cell(result.case.question),
            cell(refs.map(formatRef).join(', ') || 'no answer expected'),
            cell(top),
          ];
        }),
      ),
      '',
    );
  }

  return lines.join('\n');
}

function metricOf(run: ReportRun) {
  return metricsOf(outcomesOf(run).map(({ outcome }) => outcome)).recall5;
}

export type RunFilter = { split?: EvalSplit; dataset?: string };

/**
 * The runs to report: the ones asked for by id, or else the latest finished run of each config
 * on one split and dataset. Runs over part of the cases (`--limit`, `--tags`) are left out of
 * the default, so a smoke test never stands in for a config's full run.
 */
export async function loadRuns(
  runIds?: string[],
  { split = 'DEV', dataset = 'core' }: RunFilter = {},
): Promise<ReportRun[]> {
  const include = { results: { include: { case: true } } } as const;
  if (runIds?.length) {
    const runs = await prismaClient.evalRun.findMany({ where: { id: { in: runIds } }, include });
    const missing = runIds.filter((id) => !runs.some((run) => run.id === id));
    if (missing.length > 0) throw new Error(`No runs ${missing.join(', ')}`);
    return runIds.map((id) => runs.find((run) => run.id === id)!);
  }

  const finished = await prismaClient.evalRun.findMany({
    where: { suite: SUITE, status: 'DONE', split, dataset: { name: dataset } },
    orderBy: [{ name: 'asc' }, { startedAt: 'desc' }],
    select: { id: true, name: true, config: true },
  });
  const latest = new Map<string, string>();
  for (const run of finished) {
    const { selection } = run.config as { selection?: CaseSelection };
    const partial = selection?.limit !== undefined || (selection?.tags?.length ?? 0) > 0;
    if (!partial && !latest.has(run.name)) latest.set(run.name, run.id);
  }
  return latest.size === 0 ? [] : loadRuns([...latest.values()]);
}

/** The latest report for a split: latest.md for DEV, latest-heldout.md for HELDOUT. */
export function latestFile(split: EvalSplit, dir = REPORT_DIR) {
  return join(dir, split === 'DEV' ? 'latest.md' : `latest-${split.toLowerCase()}.md`);
}

/** Writes the dated report and the split's latest file; returns the dated file's path. */
export async function writeReport(
  runs: ReportRun[],
  dir = REPORT_DIR,
  date = new Date(),
  split: EvalSplit = 'DEV',
) {
  const markdown = renderReport(runs, date);
  await mkdir(dir, { recursive: true });
  const day = date.toISOString().slice(0, 10);
  const file = join(dir, `${day}-${SUITE}-${split.toLowerCase()}.md`);
  await writeFile(file, markdown);
  await writeFile(latestFile(split, dir), markdown);
  return file;
}
