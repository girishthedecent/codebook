import { z } from 'zod';
import type { Metrics } from './scorers/retrieval.js';

// The CI gate's verdict: a retrieval run on the gate cases against the committed baseline.
// Pure, so the rules are tested without a database.

export const GATED_METRICS = ['recall5', 'recall10', 'mrr', 'errors'] as const;
export type GatedMetric = (typeof GATED_METRICS)[number];

// Shown next to the gated ones, never failing the gate: 4 no-answer cases make one flip a
// 0.25 swing.
const INFO_METRICS = ['hit5', 'ndcg10', 'noAnswerAccuracy', 'falseWeakRate'] as const;

// How far a metric may move the wrong way before the gate fails. Errors may not grow at all.
export const DEFAULT_TOLERANCES: Record<GatedMetric, number> = {
  recall5: 0.03,
  recall10: 0.03,
  mrr: 0.03,
  errors: 0,
};

// Rounding noise: 0.9 - 0.87 is 0.030000000000000027 in floating point.
const EPSILON = 1e-9;

// What a baseline and a run are compared on besides the metrics: if any of these differ,
// the numbers measure a different corpus or different questions.
const fingerprintSchema = z.object({
  corpusVersion: z.string(),
  // Content hash of each source (sourceKey → hash): the docs page is fetched live and can
  // change under the same URL.
  sourceHashes: z.record(z.string(), z.string().nullable()),
  casesHash: z.string(),
  cases: z.int().nonnegative(),
});

export type GateFingerprint = z.infer<typeof fingerprintSchema>;

export const baselineSchema = fingerprintSchema.extend({
  dataset: z.string(),
  config: z.string(),
  split: z.enum(['DEV', 'HELDOUT']),
  tags: z.array(z.string()),
  metrics: z.record(z.string(), z.number().nullable()),
  tolerances: z.record(z.string(), z.number().nonnegative()),
  runId: z.string(),
  gitSha: z.string(),
  createdAt: z.string(),
});

export type Baseline = z.infer<typeof baselineSchema>;

export type GateRow = {
  metric: string;
  baseline: number | null;
  current: number | null;
  delta: number | null;
  // Null for metrics shown for information only.
  tolerance: number | null;
  ok: boolean;
};

export type GateResult = {
  // `stale`: the corpus or the cases changed since the baseline, so the comparison means
  // nothing until `pnpm evals:baseline` is run again (and reviewed).
  status: 'pass' | 'regression' | 'stale';
  reasons: string[];
  rows: GateRow[];
};

const lowerIsBetter = (metric: string) => metric === 'errors' || metric === 'falseWeakRate';

function staleReasons(baseline: GateFingerprint, current: GateFingerprint) {
  const reasons: string[] = [];
  if (baseline.corpusVersion !== current.corpusVersion) {
    reasons.push(
      `corpus version ${current.corpusVersion} is not the baseline's ${baseline.corpusVersion}`,
    );
  }
  const keys = [
    ...new Set([...Object.keys(baseline.sourceHashes), ...Object.keys(current.sourceHashes)]),
  ];
  for (const key of keys.sort()) {
    if (baseline.sourceHashes[key] !== current.sourceHashes[key]) {
      reasons.push(`the content of source "${key}" changed since the baseline`);
    }
  }
  if (baseline.casesHash !== current.casesHash || baseline.cases !== current.cases) {
    reasons.push(`the gate cases changed (${baseline.cases} → ${current.cases} cases)`);
  }
  return reasons;
}

function metricValue(metrics: Partial<Record<string, number | null>>, metric: string) {
  const value = metrics[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function compareToBaseline(
  baseline: Baseline,
  current: GateFingerprint & { metrics: Partial<Metrics> },
): GateResult {
  const metrics = current.metrics as Partial<Record<string, number | null>>;
  const rows: GateRow[] = [];
  const failures: string[] = [];

  for (const metric of [...GATED_METRICS, ...INFO_METRICS]) {
    const gated = (GATED_METRICS as readonly string[]).includes(metric);
    const before = metricValue(baseline.metrics, metric);
    const after = metricValue(metrics, metric);
    const tolerance = gated
      ? (baseline.tolerances[metric] ?? DEFAULT_TOLERANCES[metric as GatedMetric])
      : null;
    const delta = before !== null && after !== null ? after - before : null;

    let ok = true;
    if (gated) {
      if (before === null) {
        ok = false;
        failures.push(`the baseline has no ${metric}`);
      } else if (after === null) {
        ok = false;
        failures.push(`this run has no ${metric}`);
      } else {
        const worse = lowerIsBetter(metric) ? delta! : -delta!;
        ok = worse <= tolerance! + EPSILON;
        if (!ok) failures.push(`${metric} ${fmt(before)} → ${fmt(after)} (tolerance ${tolerance})`);
      }
    }
    rows.push({ metric, baseline: before, current: after, delta, tolerance, ok });
  }

  const stale = staleReasons(baseline, current);
  if (stale.length > 0) return { status: 'stale', reasons: stale, rows };
  return failures.length > 0
    ? { status: 'regression', reasons: failures, rows }
    : { status: 'pass', reasons: [], rows };
}

const fmt = (value: number | null) =>
  value === null ? '–' : Number.isInteger(value) ? String(value) : value.toFixed(3);

const signed = (value: number | null) =>
  value === null
    ? '–'
    : `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(3)}`;

const HEADLINES: Record<GateResult['status'], string> = {
  pass: '✅ Retrieval gate passed',
  regression: '❌ Retrieval gate failed: a metric dropped past its tolerance',
  stale: '⚠️ Retrieval gate failed: the baseline no longer matches the corpus or the cases',
};

export function renderGateMarkdown(
  result: GateResult,
  info: { runId: string; baselineRunId: string; cases: number },
) {
  const lines = [
    `## ${HEADLINES[result.status]}`,
    '',
    `Run \`${info.runId}\` on ${info.cases} gate cases, against baseline run \`${info.baselineRunId}\`.`,
    '',
  ];
  if (result.reasons.length > 0) {
    lines.push(...result.reasons.map((reason) => `- ${reason}`), '');
  }
  if (result.status === 'stale') {
    lines.push(
      'Run `pnpm evals:baseline` on the new corpus and commit `evals/baseline.json` with the change.',
      '',
    );
  }
  lines.push('| Metric | Baseline | This run | Δ | Tolerance | |', '|---|---|---|---|---|---|');
  for (const row of result.rows) {
    const tolerance = row.tolerance === null ? 'info' : String(row.tolerance);
    const mark = row.tolerance === null ? '' : row.ok ? '✓' : '✗';
    lines.push(
      `| ${row.metric} | ${fmt(row.baseline)} | ${fmt(row.current)} | ${signed(row.delta)} | ${tolerance} | ${mark} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
