import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import prismaClient from '../src/config/db.config.js';
import type { EvalCase, EvalResult, EvalRun } from '../src/generated/prisma/client.js';
import type { EvalSplit } from '../src/generated/prisma/enums.js';
import {
  ANSWER_SUITE,
  type AnswerMetrics,
  type AnswerOutcome,
  type AnswerScores,
  type StoredAnswerContext,
  type StoredTrajectory,
} from './answer.types.js';
import { cell, fixed, REPORT_DIR, table } from './reportMarkdown.js';
import { answerMetrics, answerOutcomeOf } from './scorers/answer.js';
import { judgeRelation } from './scorers/judge.js';

// Renders answer runs as a Markdown report. Reports are committed and the corpus includes a
// copyrighted book, so they hold numbers, case ids and tool names only: never an answer,
// a claim, a passage or a judge's reason.

export type AnswerReportRun = EvalRun & {
  results: (EvalResult & { case: EvalCase })[];
};

const CASE_TYPES = ['BOOK', 'CODE', 'MULTI_HOP', 'CROSS_SOURCE', 'NO_ANSWER'] as const;
const STATIC = 'static-rag';
const ADAPTIVE = 'adaptive-agent';

const money = (value: number | null) => (value === null ? '–' : `$${value.toFixed(4)}`);
const millis = (value: number | null) => (value === null ? '–' : `${Math.round(value)} ms`);
const delta = (a: number | null, b: number | null) =>
  a === null || b === null ? '–' : `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(3)}`;

type Case = { caseId: string; outcome: AnswerOutcome; result: AnswerReportRun['results'][number] };

function casesOf(run: AnswerReportRun): Case[] {
  return run.results.map((result) => ({
    caseId: result.caseId,
    outcome: answerOutcomeOf(result, result.case),
    result,
  }));
}

/** The model that answered most of the run's cases, as provider/model. */
export function answerModelOf(run: AnswerReportRun) {
  const counts = new Map<string, number>();
  for (const result of run.results) {
    const model = (result.toolTrajectory as StoredTrajectory | null)?.model;
    if (model) counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The answer model the run was configured with, else the one that answered most cases. */
function answerModelFor(run: AnswerReportRun) {
  return (run.models as { answer?: string } | null)?.answer ?? answerModelOf(run);
}

/** The corpus variant the run searched, from its stored config. */
export function corpusOf(run: Pick<EvalRun, 'config'>) {
  const { corpus } = run.config as { corpus?: { variant?: string } };
  return corpus?.variant ?? 'context';
}

/** The judge stored with the run, else the one its cases' scores name. */
export function judgeOf(run: { models: EvalRun['models']; results: Pick<EvalResult, 'scores'>[] }) {
  const stored = (run.models as { judge?: string } | null)?.judge;
  if (stored) return stored;
  for (const result of run.results) {
    const model = (result.scores as Partial<AnswerScores> | null)?.judge?.model;
    if (model) return model;
  }
  return 'unknown';
}

function isLongContext(run: AnswerReportRun) {
  return run.results.some(
    (result) => (result.retrieved as StoredAnswerContext | null)?.longContext,
  );
}

/** Long-context: every expected ref was inside the stuffed text. */
function covered(result: Case['result']) {
  const context = result.retrieved as StoredAnswerContext | null;
  const refs = context?.longContext?.refsCovered;
  return refs ? refs.every(Boolean) : null;
}

const metricsOf = (cases: Case[]) => answerMetrics(cases.map((c) => c.outcome));

function judgeMark(run: AnswerReportRun) {
  const relation = judgeRelation(answerModelFor(run), judgeOf(run));
  return relation.selfJudged ? 'self-judged' : relation.sameProvider ? 'same-provider judge' : null;
}

function flags(run: AnswerReportRun, metrics: AnswerMetrics) {
  const marks: string[] = [];
  if (metrics.errors > 0) marks.push(`${metrics.errors} errors`);
  if (metrics.tainted > 0) marks.push(`${metrics.tainted} tainted`);
  const mark = judgeMark(run);
  if (mark) marks.push(mark);
  const { selection } = run.config as { selection?: { limit?: number; tags?: string[] } };
  if (selection?.limit !== undefined) marks.push(`limit ${selection.limit}`);
  if (selection?.tags?.length) marks.push(`tags ${selection.tags.join(', ')}`);
  return marks.join(', ') || '–';
}

function resultRow(run: AnswerReportRun, cases: Case[]) {
  const m = metricsOf(cases);
  return [
    run.name,
    answerModelFor(run) ?? '–',
    String(m.cases),
    fixed(m.correctness),
    fixed(m.faithfulness),
    fixed(m.citationPrecision),
    fixed(m.citationRecall),
    fixed(m.noAnswerAccuracy),
    fixed(m.expectedToolRate),
    m.avgSteps === null ? '–' : m.avgSteps.toFixed(1),
    fixed(m.redundantCallRate),
    fixed(m.maxStepsRate),
    millis(m.p50LatencyMs),
    millis(m.p95LatencyMs),
    money(m.costPerQueryUsd),
    flags(run, m),
  ];
}

const RESULT_HEAD = [
  'Config',
  'Answer model',
  'Cases',
  'Correct',
  'Faithful',
  'Cit. precision',
  'Cit. recall',
  'No-answer',
  'Expected tool',
  'Steps',
  'Redundant',
  'Max steps',
  'p50',
  'p95',
  'Cost / query',
  'Notes',
];

/** Cases both runs answered, so a comparison isn't skewed by which cases each one ran. */
function shared(a: AnswerReportRun, b: AnswerReportRun): [Case[], Case[]] {
  const ids = new Set(b.results.map((result) => result.caseId));
  const left = casesOf(a).filter((c) => ids.has(c.caseId));
  const keep = new Set(left.map((c) => c.caseId));
  return [left, casesOf(b).filter((c) => keep.has(c.caseId))];
}

function typeCell(cases: Case[], type: string) {
  const group = cases.filter((c) => c.outcome.type === type);
  if (group.length === 0) return '–';
  const m = metricsOf(group);
  return `${fixed(type === 'NO_ANSWER' ? m.noAnswerAccuracy : m.correctness)} (${group.length})`;
}

function staticVsAdaptive(runs: AnswerReportRun[], h: string) {
  const staticRun = runs.find((run) => run.name === STATIC);
  const adaptive = runs.find((run) => run.name === ADAPTIVE);
  if (!staticRun || !adaptive) return [];
  const [left, right] = shared(staticRun, adaptive);
  const rows = [...CASE_TYPES, 'all'].flatMap((type) => {
    const pick = (cases: Case[]) =>
      type === 'all' ? cases : cases.filter((c) => c.outcome.type === type);
    const a = pick(left);
    const b = pick(right);
    if (a.length === 0) return [];
    const ma = metricsOf(a);
    const mb = metricsOf(b);
    const score = (m: AnswerMetrics) => (type === 'NO_ANSWER' ? m.noAnswerAccuracy : m.correctness);
    return [
      [
        type,
        String(a.length),
        fixed(score(ma)),
        fixed(score(mb)),
        delta(score(ma), score(mb)),
        fixed(ma.faithfulness),
        fixed(mb.faithfulness),
        fixed(ma.citationRecall),
        fixed(mb.citationRecall),
      ],
    ];
  });
  return [
    `${h} Static RAG vs adaptive agent`,
    '',
    'On the cases both runs answered. Correctness (no-answer accuracy for NO_ANSWER), then ' +
      'faithfulness and citation recall.',
    '',
    table(
      [
        'Type',
        'Cases',
        'Static',
        'Adaptive',
        'Δ',
        'Static faithful',
        'Adaptive faithful',
        'Static cit. recall',
        'Adaptive cit. recall',
      ],
      rows,
    ),
    '',
  ];
}

function modelComparison(runs: AnswerReportRun[], h: string) {
  const models = runs.filter((run) => run.name.startsWith('model-'));
  if (models.length < 2) return [];
  // Every model on the cases they all answered.
  const common = models
    .map((run) => new Set(run.results.map((result) => result.caseId)))
    .reduce((a, b) => new Set([...a].filter((id) => b.has(id))));
  return [
    `${h} Model comparison`,
    '',
    `On the ${common.size} cases every model run answered.`,
    '',
    table(
      RESULT_HEAD,
      models.map((run) =>
        resultRow(
          run,
          casesOf(run).filter((c) => common.has(c.caseId)),
        ),
      ),
    ),
    '',
  ];
}

function keptShares(run: AnswerReportRun) {
  const totals = new Map<string, { kept: number; total: number }>();
  for (const result of run.results) {
    const kept = (result.retrieved as StoredAnswerContext | null)?.longContext?.kept ?? {};
    for (const [key, value] of Object.entries(kept)) {
      // Every case stuffs the same corpus, so one case's numbers stand for the run.
      if (!totals.has(key)) totals.set(key, { kept: value.tokens, total: value.total });
    }
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, { kept, total }]) =>
        `${key} ${total === 0 ? 0 : Math.round((kept / total) * 100)}% of ${total} tokens`,
    )
    .join(', ');
}

function longContextVsRag(runs: AnswerReportRun[], h: string) {
  const rag = runs.find((run) => run.name === ADAPTIVE) ?? runs.find((run) => run.name === STATIC);
  const lines: string[] = [];
  for (const run of runs.filter(isLongContext)) {
    const all = casesOf(run);
    const inside = all.filter((c) => covered(c.result) === true);
    const insideIds = new Set(inside.map((c) => c.caseId));
    const row = (label: string, cases: Case[]) => {
      const m = metricsOf(cases);
      return [
        label,
        String(m.cases),
        fixed(m.correctness),
        fixed(m.noAnswerAccuracy),
        millis(m.p50LatencyMs),
        money(m.costPerQueryUsd),
      ];
    };
    const rows = [
      row(`${run.name}, all cases`, all),
      row(`${run.name}, refs in the prompt`, inside),
    ];
    if (rag) {
      const [, ragCases] = shared(run, rag);
      rows.push(row(`${rag.name}, same cases`, ragCases));
      rows.push(
        row(
          `${rag.name}, refs in the prompt`,
          ragCases.filter((c) => insideIds.has(c.caseId)),
        ),
      );
    }
    lines.push(
      `${h} Long context vs RAG (${run.name})`,
      '',
      `The corpus didn't fit the prompt, so each source was cut: ${keptShares(run) || 'no data'}. ` +
        '"Refs in the prompt" keeps the cases whose expected pages or lines were inside the ' +
        'stuffed text (NO_ANSWER cases have none, so they count as inside), which separates ' +
        'the method from the truncation. Long-context answers have no passages, so only ' +
        'correctness and no-answer are judged.',
      '',
      table(['Run', 'Cases', 'Correct', 'No-answer', 'p50', 'Cost / query'], rows),
      '',
    );
  }
  return lines;
}

function lowestCases(run: AnswerReportRun, count: number, h: string) {
  const ranked = casesOf(run)
    .map((c) => {
      const scores = c.outcome.scores;
      const badness = c.outcome.error
        ? 3
        : !scores
          ? 2
          : c.outcome.type === 'NO_ANSWER'
            ? scores.noAnswerCorrect === false
              ? 1.5
              : 0
            : 1 - (scores.correctness ?? 1) + (1 - (scores.faithfulness ?? 1)) / 2;
      return { ...c, badness };
    })
    .filter((c) => c.badness > 0)
    .sort(
      (a, b) =>
        b.badness - a.badness || a.result.case.externalId.localeCompare(b.result.case.externalId),
    )
    .slice(0, count);

  const used = (c: Case) => {
    const trajectory = c.result.toolTrajectory as StoredTrajectory | null;
    return [...new Set(trajectory?.calls.map((call) => call.tool) ?? [])].join(', ') || 'none';
  };
  const scoreOf = (c: Case, pick: (scores: AnswerScores) => number | null) =>
    c.outcome.scores ? fixed(pick(c.outcome.scores)) : '–';

  return [
    `${h} Lowest-scoring cases of ${run.name}`,
    '',
    ranked.length === 0
      ? 'None.'
      : table(
          [
            'Case',
            'Type',
            'Correct',
            'Faithful',
            'Cit. recall',
            'Expected tools',
            'Tools used',
            'Notes',
          ],
          ranked.map((c) => [
            c.result.case.externalId,
            c.outcome.type,
            scoreOf(c, (s) => s.correctness),
            scoreOf(c, (s) => s.faithfulness),
            scoreOf(c, (s) => s.citationRecall),
            cell(c.outcome.scores?.trajectory.expectedTools.join(', ') || '–'),
            cell(used(c)),
            c.outcome.error
              ? 'error'
              : c.outcome.scores?.judge.skipped
                ? 'judge skipped'
                : c.outcome.scores?.tainted
                  ? 'tainted'
                  : '–',
          ]),
        ),
    '',
  ];
}

const METRICS_NOTE =
  'Each metric is a mean over the cases where it was measured: errored cases and skipped ' +
  'judge calls are counted in the notes, not scored as 0. Correct is graded against the ' +
  'reference answer (0, 0.5 or 1); faithful is the share of claims the cited passages ' +
  'support; citation precision the share of citations whose passage supports their ' +
  'sentence; citation recall the share of expected refs a cited passage hits. A tainted ' +
  'case fell back to another answer model or lost a judge call.';

/** Runs that can stand side by side: same corpus and same judge. */
function comparableGroups(runs: AnswerReportRun[]) {
  const groups = new Map<string, { corpus: string; judge: string; runs: AnswerReportRun[] }>();
  for (const run of runs) {
    const corpus = corpusOf(run);
    const judge = judgeOf(run);
    const key = `${corpus}\0${judge}`;
    const group = groups.get(key) ?? { corpus, judge, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function renderGroup(runs: AnswerReportRun[], judge: string, h: string) {
  const lines: string[] = [];
  const flagged = runs.filter((run) => judgeMark(run) !== null);
  if (flagged.length > 0) {
    lines.push(
      `Marked self-judged or same-provider judge: ${flagged.map((run) => run.name).join(', ')}. ` +
        `Those answers come from ${judge} itself or another model of its provider, and a judge ` +
        'tends to rate its own model family higher, so their correct, faithful and citation ' +
        'precision numbers may read high next to the other runs. Citation recall, the tool ' +
        'columns, latency and cost involve no judge.',
      '',
    );
  }

  lines.push(
    `${h} Results`,
    '',
    table(
      RESULT_HEAD,
      runs.map((run) => resultRow(run, casesOf(run))),
    ),
    '',
  );

  lines.push(
    `${h} By case type`,
    '',
    'Correctness (cases); no-answer accuracy for NO_ANSWER.',
    '',
    table(
      ['Config', ...CASE_TYPES],
      runs.map((run) => [run.name, ...CASE_TYPES.map((type) => typeCell(casesOf(run), type))]),
    ),
    '',
  );

  lines.push(
    ...staticVsAdaptive(runs, h),
    ...modelComparison(runs, h),
    ...longContextVsRag(runs, h),
  );

  const focus = runs.find((run) => run.name === ADAPTIVE) ?? runs[0]!;
  lines.push(...lowestCases(focus, 10, h));
  return lines;
}

export function renderAnswerReport(runs: AnswerReportRun[], date = new Date()) {
  const lines: string[] = [];
  const day = date.toISOString().slice(0, 10);
  lines.push(`# Answer evals, ${day}`, '');
  if (runs.length === 0) {
    lines.push('No finished runs.', '');
    return lines.join('\n');
  }

  const shas = [...new Set(runs.map((run) => run.gitSha))].join(', ');
  const splits = [...new Set(runs.map((run) => run.split))].join(', ');
  const groups = comparableGroups(runs);

  if (groups.length === 1) {
    const [{ corpus, judge }] = groups as [(typeof groups)[number]];
    lines.push(
      `Split ${splits} · code ${shas} · ${runs.length} runs · corpus ${corpus} · judge ` +
        `${judge}. ${METRICS_NOTE}`,
      '',
      ...renderGroup(runs, judge, '##'),
    );
    return lines.join('\n');
  }

  // Scores from another judge or another corpus don't compare: each group stands alone.
  lines.push(
    `Split ${splits} · code ${shas} · ${runs.length} runs in ${groups.length} groups by ` +
      `corpus and judge, each reported on its own. ${METRICS_NOTE}`,
    '',
  );
  for (const group of groups) {
    lines.push(
      `## Corpus ${group.corpus}, judge ${group.judge}`,
      '',
      ...renderGroup(group.runs, group.judge, '###'),
    );
  }
  return lines.join('\n');
}

export type AnswerRunFilter = { split?: EvalSplit; dataset?: string; corpus?: string };

/**
 * The runs to report: the ones asked for by id (grouped by corpus and judge when they
 * differ), or else the latest finished answer run of each config on one split, dataset and
 * corpus, judged by the judge of the newest of those runs. Answer runs are usually limited
 * (free-tier quotas), so limited runs count; the notes column says so.
 */
export async function loadAnswerRuns(
  runIds?: string[],
  { split = 'DEV', dataset = 'core', corpus = 'context' }: AnswerRunFilter = {},
): Promise<AnswerReportRun[]> {
  const include = { results: { include: { case: true } } } as const;
  if (runIds?.length) {
    const runs = await prismaClient.evalRun.findMany({ where: { id: { in: runIds } }, include });
    const missing = runIds.filter((id) => !runs.some((run) => run.id === id));
    if (missing.length > 0) throw new Error(`No runs ${missing.join(', ')}`);
    const other = runs.find((run) => run.suite !== ANSWER_SUITE);
    if (other) throw new Error(`Run ${other.id} is a ${other.suite} run, not an answer run`);
    return runIds.map((id) => runs.find((run) => run.id === id)!);
  }

  const finished = await prismaClient.evalRun.findMany({
    where: { suite: ANSWER_SUITE, status: 'DONE', split, dataset: { name: dataset } },
    orderBy: [{ startedAt: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, config: true, models: true },
  });
  const inCorpus = finished.filter((run) => corpusOf(run) === corpus);
  if (inCorpus.length === 0) return [];

  const judges = new Map<string, string>();
  for (const run of inCorpus) {
    const first = await prismaClient.evalResult.findFirst({
      where: { runId: run.id },
      select: { scores: true },
    });
    judges.set(run.id, judgeOf({ models: run.models, results: first ? [first] : [] }));
  }
  // The newest run's judge: an older judge's runs belong to an older report.
  const judge = judges.get(inCorpus[0]!.id);
  const latest = new Map<string, string>();
  for (const run of inCorpus) {
    if (judges.get(run.id) === judge && !latest.has(run.name)) latest.set(run.name, run.id);
  }
  const ids = [...latest].sort(([a], [b]) => a.localeCompare(b)).map(([, id]) => id);
  return loadAnswerRuns(ids);
}

export function latestAnswerFile(split: EvalSplit, dir = REPORT_DIR) {
  return join(
    dir,
    split === 'DEV' ? 'latest-answer.md' : `latest-answer-${split.toLowerCase()}.md`,
  );
}

export async function writeAnswerReport(
  runs: AnswerReportRun[],
  dir = REPORT_DIR,
  date = new Date(),
  split: EvalSplit = 'DEV',
) {
  const markdown = renderAnswerReport(runs, date);
  await mkdir(dir, { recursive: true });
  const day = date.toISOString().slice(0, 10);
  const file = join(dir, `${day}-${ANSWER_SUITE}-${split.toLowerCase()}.md`);
  await writeFile(file, markdown);
  await writeFile(latestAnswerFile(split, dir), markdown);
  return file;
}
