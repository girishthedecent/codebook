import { describe, expect, it } from 'vitest';
import {
  compareToBaseline,
  DEFAULT_TOLERANCES,
  renderGateMarkdown,
  type Baseline,
} from './gateCompare.js';

const fingerprint = {
  corpusVersion: 'abc123',
  sourceHashes: { repo: 'r1', docs: 'd1' },
  casesHash: 'cases1',
  cases: 28,
};

const baseline: Baseline = {
  ...fingerprint,
  dataset: 'core',
  config: 'gate',
  split: 'DEV',
  tags: ['gate'],
  metrics: {
    recall5: 0.9,
    recall10: 0.95,
    mrr: 0.8,
    errors: 0,
    hit5: 0.92,
    ndcg10: 0.85,
    noAnswerAccuracy: 0.5,
    falseWeakRate: 0,
  },
  tolerances: DEFAULT_TOLERANCES,
  runId: 'run-base',
  gitSha: 'deadbeef',
  createdAt: '2026-10-24T00:00:00.000Z',
};

const current = (metrics: Record<string, number | null>, changes = {}) => ({
  ...fingerprint,
  ...changes,
  metrics: { ...baseline.metrics, ...metrics },
});

describe('compareToBaseline', () => {
  it('passes when every gated metric holds', () => {
    const result = compareToBaseline(baseline, current({ recall5: 0.91, mrr: 0.79 }));
    expect(result.status).toBe('pass');
    expect(result.reasons).toEqual([]);
    expect(result.rows.find((row) => row.metric === 'mrr')).toMatchObject({
      baseline: 0.8,
      current: 0.79,
      ok: true,
    });
  });

  it('fails when a metric drops past its tolerance', () => {
    const result = compareToBaseline(baseline, current({ recall5: 0.86 }));
    expect(result.status).toBe('regression');
    expect(result.reasons).toEqual([expect.stringMatching(/^recall5 0\.900 → 0\.860/)]);
  });

  it('passes a drop of exactly the tolerance, despite floating point', () => {
    // 0.9 - 0.87 is 0.030000000000000027.
    expect(compareToBaseline(baseline, current({ recall5: 0.87 })).status).toBe('pass');
    expect(compareToBaseline(baseline, current({ recall5: 0.869 })).status).toBe('regression');
  });

  it('allows no new errors', () => {
    const result = compareToBaseline(baseline, current({ errors: 1 }));
    expect(result.status).toBe('regression');
    expect(result.reasons).toEqual([expect.stringMatching(/^errors 0 → 1/)]);
  });

  it('never fails on the information-only metrics', () => {
    const result = compareToBaseline(baseline, current({ noAnswerAccuracy: 0, hit5: 0.1 }));
    expect(result.status).toBe('pass');
    expect(result.rows.find((row) => row.metric === 'hit5')!.tolerance).toBeNull();
  });

  it('fails when a gated metric is missing on either side', () => {
    const missingNow = compareToBaseline(baseline, current({ mrr: null }));
    expect(missingNow.status).toBe('regression');
    expect(missingNow.reasons).toEqual(['this run has no mrr']);

    const { recall10: _, ...withoutRecall10 } = baseline.metrics;
    const missingThen = compareToBaseline({ ...baseline, metrics: withoutRecall10 }, current({}));
    expect(missingThen.status).toBe('regression');
    expect(missingThen.reasons).toEqual(['the baseline has no recall10']);
  });

  it('calls a changed corpus or case set stale, not a regression', () => {
    const docs = compareToBaseline(
      baseline,
      current({ recall5: 0.5 }, { sourceHashes: { repo: 'r1', docs: 'd2' } }),
    );
    expect(docs.status).toBe('stale');
    expect(docs.reasons).toEqual(['the content of source "docs" changed since the baseline']);

    const version = compareToBaseline(baseline, current({}, { corpusVersion: 'other' }));
    expect(version.status).toBe('stale');
    expect(version.reasons[0]).toMatch(/corpus version other/);

    const cases = compareToBaseline(baseline, current({}, { cases: 27, casesHash: 'cases2' }));
    expect(cases.reasons).toEqual(['the gate cases changed (28 → 27 cases)']);
  });
});

describe('renderGateMarkdown', () => {
  it('shows the verdict, the reasons and a row per metric', () => {
    const result = compareToBaseline(baseline, current({ recall5: 0.8 }));
    const markdown = renderGateMarkdown(result, {
      runId: 'run-new',
      baselineRunId: 'run-base',
      cases: 28,
    });
    expect(markdown).toContain('Retrieval gate failed');
    expect(markdown).toContain('- recall5 0.900 → 0.800 (tolerance 0.03)');
    expect(markdown).toContain('| recall5 | 0.900 | 0.800 | -0.100 | 0.03 | ✗ |');
    expect(markdown).toContain('| hit5 | 0.920 | 0.920 | 0 | info |  |');
  });

  it('tells how to rebaseline when the corpus changed', () => {
    const result = compareToBaseline(baseline, current({}, { corpusVersion: 'other' }));
    const markdown = renderGateMarkdown(result, { runId: 'r', baselineRunId: 'b', cases: 28 });
    expect(markdown).toContain('pnpm evals:baseline');
  });
});
