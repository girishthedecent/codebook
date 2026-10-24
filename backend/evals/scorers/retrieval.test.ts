import { describe, expect, it } from 'vitest';
import {
  metricsOf,
  ndcgAt,
  percentile,
  reciprocalRank,
  recallAt,
  scoreRanking,
  summarize,
  type CaseOutcome,
} from './retrieval.js';

describe('ranking metrics', () => {
  // Two expected refs: ref 0 found at rank 2 (and again at 3), ref 1 at rank 7.
  const hits = [[], [0], [0], [], [], [], [1], [], [], []];

  it('counts each ref once for recall', () => {
    expect(recallAt(hits, 2, 5)).toBe(0.5);
    expect(recallAt(hits, 2, 10)).toBe(1);
    expect(recallAt([], 2, 5)).toBe(0);
  });

  it('takes MRR from the first hit within the top 10', () => {
    expect(reciprocalRank(hits)).toBe(0.5);
    expect(reciprocalRank([...Array<number[]>(10).fill([]), [0]])).toBe(0);
  });

  it('gives nDCG 1 for a perfect ranking and less when hits come late or repeat', () => {
    expect(ndcgAt([[0], [1]], 2, 10)).toBe(1);
    const ideal = 1 + 1 / Math.log2(3);
    expect(ndcgAt(hits, 2, 10)).toBeCloseTo((1 / Math.log2(3) + 1 / Math.log2(8)) / ideal);
    // A chunk hitting both refs at once can't push the score over 1.
    expect(ndcgAt([[0, 1]], 2, 10)).toBeCloseTo(1 / ideal);
  });

  it('bundles the scores for a case', () => {
    expect(scoreRanking(hits, 2)).toEqual({
      recall5: 0.5,
      recall10: 1,
      hit5: 1,
      mrr: 0.5,
      ndcg10: expect.any(Number),
    });
    expect(scoreRanking([[], []], 1)).toMatchObject({ recall5: 0, hit5: 0, mrr: 0, ndcg10: 0 });
  });
});

const outcome = (fields: Partial<CaseOutcome>): CaseOutcome => ({
  type: 'BOOK',
  tags: [],
  reviewed: false,
  answerable: true,
  scores: { recall5: 1, recall10: 1, hit5: 1, mrr: 1, ndcg10: 1 },
  weak: false,
  error: false,
  tainted: false,
  latencyMs: 100,
  timings: { total: 100 },
  ...fields,
});

describe('run metrics', () => {
  it('keeps NO_ANSWER cases out of recall and scores them on the weak flag', () => {
    const metrics = metricsOf([
      outcome({}),
      outcome({ answerable: false, type: 'NO_ANSWER', scores: undefined, weak: true }),
      outcome({ answerable: false, type: 'NO_ANSWER', scores: undefined, weak: false }),
    ]);
    expect(metrics).toMatchObject({ cases: 3, answerable: 1, recall5: 1, noAnswerCases: 2 });
    expect(metrics.noAnswerAccuracy).toBe(0.5);
  });

  it('reports answerable cases called weak as false-weak', () => {
    const metrics = metricsOf([outcome({ weak: true }), outcome({}), outcome({}), outcome({})]);
    expect(metrics.falseWeakRate).toBe(0.25);
    expect(metrics.noAnswerAccuracy).toBeNull();
  });

  it('counts an errored case as a miss', () => {
    const metrics = metricsOf([outcome({}), outcome({ error: true, scores: undefined })]);
    expect(metrics).toMatchObject({ recall5: 0.5, errors: 1 });
    const noAnswer = metricsOf([
      outcome({ answerable: false, type: 'NO_ANSWER', error: true, weak: true }),
    ]);
    expect(noAnswer.noAnswerAccuracy).toBe(0);
  });

  it('groups by type, tag and review state, and counts tainted cases', () => {
    const summary = summarize([
      outcome({ type: 'CODE', tags: ['auth', 'flow'], reviewed: true, tainted: true }),
      outcome({
        type: 'BOOK',
        tags: ['auth'],
        scores: { recall5: 0, recall10: 0, hit5: 0, mrr: 0, ndcg10: 0 },
      }),
    ]);
    expect(Object.keys(summary.byType)).toEqual(['BOOK', 'CODE']);
    expect(summary.byTag.auth?.cases).toBe(2);
    expect(summary.byTag.flow?.recall5).toBe(1);
    expect(summary.byReview.reviewed?.cases).toBe(1);
    expect(summary.taintedCases).toBe(1);
  });

  it('takes nearest-rank percentiles', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
  });
});
