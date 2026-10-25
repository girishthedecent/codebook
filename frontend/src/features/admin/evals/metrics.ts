import { metric, ms, usd } from '../format';

// What each suite's summary holds (backend evals/scorers/retrieval.ts and answer.types.ts).
// The API types `overall` and `summary` as open records, so this file is where their keys live.

export type Suite = 'retrieval' | 'answer' | string;

export type MetricDef = {
  key: string;
  label: string;
  format: (v: unknown) => string;
  /** Higher is better; false for rates of bad things and latencies. */
  higherIsBetter: boolean;
};

const m = (key: string, label: string, higherIsBetter = true, format = metric): MetricDef => ({
  key,
  label,
  format,
  higherIsBetter,
});

export const metricsBySuite: Record<string, MetricDef[]> = {
  retrieval: [
    m('recall5', 'recall@5'),
    m('recall10', 'recall@10'),
    m('mrr', 'MRR'),
    m('ndcg10', 'nDCG@10'),
    m('hit5', 'hit@5'),
    m('noAnswerAccuracy', 'no-answer accuracy'),
    m('falseWeakRate', 'false weak rate', false),
  ],
  answer: [
    m('correctness', 'correctness'),
    m('faithfulness', 'faithfulness'),
    m('citationPrecision', 'citation accuracy'),
    m('citationRecall', 'citation recall'),
    m('noAnswerAccuracy', 'no-answer accuracy'),
    m('expectedToolRate', 'expected tool rate'),
    m('redundantCallRate', 'redundant calls', false),
    m('p50LatencyMs', 'latency p50', false, ms),
    m('costPerQueryUsd', 'cost / query', false, (v) => usd(typeof v === 'number' ? v : null)),
  ],
};

/** The one number a suite is judged by: per type in the breakdown, per case in the table. */
export const headline: Record<string, MetricDef> = {
  retrieval: metricsBySuite.retrieval![0]!,
  answer: metricsBySuite.answer![0]!,
};

export function metricsFor(suite: Suite) {
  return metricsBySuite[suite] ?? [];
}

export function headlineFor(suite: Suite): MetricDef {
  return headline[suite] ?? m('score', 'score');
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Runs-table columns: the same five for every suite, blank where a suite has no such number. */
export function runColumns(overall: Record<string, unknown> | null) {
  const o = overall ?? {};
  return {
    recall5: metric(o.recall5),
    mrr: metric(o.mrr),
    faithfulness: metric(o.faithfulness),
    citations: metric(o.citationPrecision),
    latency: ms(o.p50LatencyMs),
  };
}

export const caseTypes = ['BOOK', 'CODE', 'MULTI_HOP', 'CROSS_SOURCE', 'NO_ANSWER'] as const;

export function typeLabel(type: string) {
  return type.toLowerCase().replace('_', '-');
}

// Config file names under backend/evals/configs/<suite>/. Only suggestions: the eval worker
// checks the name and refuses one that doesn't exist.
export const knownConfigs: Record<string, string[]> = {
  retrieval: [
    'hybrid',
    'hybrid-rerank',
    'hybrid-rerank-bge',
    'hybrid-rerank-decompose',
    'hybrid-rerank-hyde',
    'hybrid-rerank-rewrite',
    'hybrid-rerank-nocontext',
    'keyword-only',
    'vector-only',
  ],
  answer: [
    'adaptive-agent',
    'static-rag',
    'vectorless-only',
    'adaptive-no-graph',
    'adaptive-no-toc',
    'long-context',
    'memory-on',
    'memory-off',
    'prompt-v3',
    'model-gemini-flash-6k5',
    'model-gpt-oss-120b-6k5',
    'model-gpt-oss-20b-6k5',
  ],
};
