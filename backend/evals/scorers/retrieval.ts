// Retrieval metrics for one case and their averages over a run.
//
// A case is a ranking where each position lists the expected refs that chunk hits (see
// matching.ts). Relevance is binary and counted per distinct ref: two chunks hitting the
// same ref find it once.

export type RankingScores = {
  recall5: number;
  recall10: number;
  hit5: number;
  mrr: number;
  ndcg10: number;
};

function distinctRefsIn(hits: number[][], k: number) {
  return new Set(hits.slice(0, k).flat()).size;
}

export function recallAt(hits: number[][], refCount: number, k: number) {
  return refCount === 0 ? 0 : distinctRefsIn(hits, k) / refCount;
}

/** 1 / rank of the first chunk that hits any ref, within the top 10. */
export function reciprocalRank(hits: number[][], k = 10) {
  const index = hits.slice(0, k).findIndex((refs) => refs.length > 0);
  return index === -1 ? 0 : 1 / (index + 1);
}

/** A position gains 1 when it finds a ref no earlier position found. */
export function ndcgAt(hits: number[][], refCount: number, k: number) {
  if (refCount === 0) return 0;
  const found = new Set<number>();
  let dcg = 0;
  hits.slice(0, k).forEach((refs, index) => {
    const fresh = refs.filter((ref) => !found.has(ref));
    if (fresh.length === 0) return;
    for (const ref of fresh) found.add(ref);
    dcg += 1 / Math.log2(index + 2);
  });
  let ideal = 0;
  for (let index = 0; index < Math.min(refCount, k); index++) ideal += 1 / Math.log2(index + 2);
  return dcg / ideal;
}

export function scoreRanking(hits: number[][], refCount: number): RankingScores {
  return {
    recall5: recallAt(hits, refCount, 5),
    recall10: recallAt(hits, refCount, 10),
    hit5: distinctRefsIn(hits, 5) > 0 ? 1 : 0,
    mrr: reciprocalRank(hits),
    ndcg10: ndcgAt(hits, refCount, 10),
  };
}

/** What one case contributed to the summary. Errors count as misses, not as gaps. */
export type CaseOutcome = {
  type: string;
  tags: string[];
  reviewed: boolean;
  answerable: boolean;
  // Answerable cases only.
  scores?: RankingScores;
  weak: boolean;
  error: boolean;
  tainted: boolean;
  latencyMs: number;
  timings: Record<string, number>;
};

export type Metrics = {
  cases: number;
  answerable: number;
  recall5: number;
  recall10: number;
  hit5: number;
  mrr: number;
  ndcg10: number;
  // Share of answerable cases the search called weak: the price of the no-answer score.
  falseWeakRate: number;
  noAnswerCases: number;
  noAnswerAccuracy: number | null;
  errors: number;
};

const ZERO: RankingScores = { recall5: 0, recall10: 0, hit5: 0, mrr: 0, ndcg10: 0 };

const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export function metricsOf(outcomes: CaseOutcome[]): Metrics {
  const answerable = outcomes.filter((outcome) => outcome.answerable);
  const noAnswer = outcomes.filter((outcome) => !outcome.answerable);
  const scores = answerable.map((outcome) => (outcome.error ? ZERO : (outcome.scores ?? ZERO)));
  const average = (key: keyof RankingScores) => mean(scores.map((score) => score[key]));

  return {
    cases: outcomes.length,
    answerable: answerable.length,
    recall5: average('recall5'),
    recall10: average('recall10'),
    hit5: average('hit5'),
    mrr: average('mrr'),
    ndcg10: average('ndcg10'),
    falseWeakRate: mean(answerable.map((outcome) => (!outcome.error && outcome.weak ? 1 : 0))),
    noAnswerCases: noAnswer.length,
    noAnswerAccuracy:
      noAnswer.length === 0
        ? null
        : mean(noAnswer.map((outcome) => (!outcome.error && outcome.weak ? 1 : 0))),
    errors: outcomes.filter((outcome) => outcome.error).length,
  };
}

/** Nearest-rank percentile; 0 for no values. */
export function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(rank, 1)) - 1]!;
}

function groupBy(outcomes: CaseOutcome[], keysOf: (outcome: CaseOutcome) => string[]) {
  const groups = new Map<string, CaseOutcome[]>();
  for (const outcome of outcomes) {
    for (const key of keysOf(outcome)) groups.set(key, [...(groups.get(key) ?? []), outcome]);
  }
  return Object.fromEntries(
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => [key, metricsOf(group)]),
  );
}

export type RunSummary = {
  overall: Metrics;
  byType: Record<string, Metrics>;
  byTag: Record<string, Metrics>;
  byReview: Record<string, Metrics>;
  // Cases where the search fell back (reranker unavailable, query mode failed, fallback model).
  taintedCases: number;
  latency: { p50: number; p95: number; stages: Record<string, { p50: number; p95: number }> };
};

export function summarize(outcomes: CaseOutcome[]): RunSummary {
  const stageNames = [...new Set(outcomes.flatMap((outcome) => Object.keys(outcome.timings)))];
  const latencies = outcomes.map((outcome) => outcome.latencyMs);

  return {
    overall: metricsOf(outcomes),
    byType: groupBy(outcomes, (outcome) => [outcome.type]),
    byTag: groupBy(outcomes, (outcome) => outcome.tags),
    byReview: groupBy(outcomes, (outcome) => [outcome.reviewed ? 'reviewed' : 'unreviewed']),
    taintedCases: outcomes.filter((outcome) => outcome.tainted).length,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      stages: Object.fromEntries(
        stageNames.map((stage) => {
          const values = outcomes.flatMap((outcome) => outcome.timings[stage] ?? []);
          return [stage, { p50: percentile(values, 50), p95: percentile(values, 95) }];
        }),
      ),
    },
  };
}
