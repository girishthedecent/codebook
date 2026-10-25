import { beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../../src/config/db.config.js';
import { textRoutes } from '../../src/llm/models.js';
import type { CheckedCitation } from '../../src/modules/citations/citations.types.js';
import { resetDb } from '../../tests/helpers/db.js';
import { apiError, promptModel, useModels } from '../../tests/helpers/llm-mock.js';
import type {
  AnswerOutcome,
  AnswerScores,
  JudgeInput,
  StoredPassage,
  StoredTrajectory,
} from '../answer.types.js';
import { answerMetrics, citationRecall, scoreAnswer, summarizeAnswers } from './answer.js';
import { declinedByPhrase, JUDGE_CAPS, judgeRelation } from './judge.js';

vi.mock('../../src/llm/providers.js', () => import('../../tests/helpers/llm-mock.js'));

const JUDGE = textRoutes.judge.primary.model;

const book: StoredPassage = {
  n: 1,
  kind: 'CHUNK',
  chunkId: 'chunk-1',
  sourceId: 'source-book',
  sourceTitle: 'Book',
  sourceKey: 'book',
  path: 'book.pdf',
  pageStart: 99,
  pageEnd: 99,
  text: 'A Bloom filter tells you when a key does not appear in the database.',
};
const code: StoredPassage = {
  n: 2,
  kind: 'LINES',
  sourceId: 'source-repo',
  sourceTitle: 'express',
  sourceKey: 'repo',
  path: 'lib/response.js',
  lineStart: 10,
  lineEnd: 20,
  text: 'res.json = function json(obj) { return this.send(body); }',
};
const unused: StoredPassage = { ...book, n: 3, chunkId: 'chunk-3', pageStart: 400, pageEnd: 400 };

const checked = ({ text: _, ...passage }: StoredPassage): CheckedCitation => ({
  ...passage,
  valid: true,
  supported: true,
  snippet: '',
});

const input = (overrides: Partial<JudgeInput> = {}): JudgeInput => ({
  caseId: 'case-1',
  type: 'MULTI_HOP',
  question: 'What do Bloom filters and res.json do?',
  expectedAnswer: 'Bloom filters skip missing keys; res.json sends JSON through res.send.',
  refs: [
    { sourceKey: 'book', pageStart: 99, pageEnd: 99 },
    { sourceKey: 'repo', path: 'lib/response.js', lineStart: 15, lineEnd: 16 },
  ],
  answer: 'A Bloom filter skips reads for missing keys [1]. res.json calls res.send [2].',
  citations: [checked(book), checked(code)],
  passages: [book, code, unused],
  grounded: true,
  ...overrides,
});

const trajectory: StoredTrajectory = {
  calls: [
    {
      step: 1,
      tool: 'trace_flow',
      args: { from: 'json' },
      ok: true,
      summary: '',
      ms: 5,
      resultTokens: 10,
    },
  ],
  steps: 2,
  forcedFinal: false,
  staticRag: false,
  model: 'google/gemini-3.6-flash',
  fallbackUsed: false,
  promptId: 'agent-system@v1',
  status: 'COMPLETE',
};

const correctness = { grade: 'partial', declined: false, reason: 'Misses the disk reads.' };
const grounding = {
  claims: [
    {
      claim: 'A Bloom filter skips reads for missing keys',
      cited: [1],
      supported: true,
      reason: 'p',
    },
    { claim: 'res.json calls res.send', cited: [2], supported: false, reason: 'q' },
  ],
  citations: [
    { n: 1, supports: true, reason: 'a' },
    { n: 1, supports: false, reason: 'repeated' },
    { n: 2, supports: false, reason: 'b' },
    { n: 7, supports: true, reason: 'not cited' },
  ],
};

let calls: string[] = [];

function judgeReplies(replies: { correctness?: unknown; grounding?: unknown | Error } = {}) {
  calls = [];
  useModels({
    [JUDGE]: promptModel((prompt) => {
      const kind = prompt.includes('<reference_answer>') ? 'correctness' : 'grounding';
      calls.push(kind);
      const reply =
        kind === 'correctness' ? (replies.correctness ?? correctness) : replies.grounding;
      if (reply instanceof Error) return reply;
      return JSON.stringify(reply ?? grounding);
    }),
  });
}

beforeEach(async () => {
  await resetDb();
  judgeReplies();
});

describe('scoreAnswer', () => {
  it('scores correctness, faithfulness, citations and the trajectory', async () => {
    const scores = await scoreAnswer(input(), trajectory, {
      judge: true,
      tags: ['tool:trace_flow'],
    });
    expect(calls).toEqual(['correctness', 'grounding']);
    expect(scores).toMatchObject({
      correctness: 0.5,
      faithfulness: 0.5,
      // The repeated and the uncited verdicts are ignored.
      citationPrecision: 0.5,
      citationRecall: 1,
      noAnswerCorrect: null,
      declined: false,
      correctnessReason: 'Misses the disk reads.',
      tainted: false,
      judge: { model: `google/${JUDGE}`, cached: 0, skipped: null },
      trajectory: { expectedToolUsed: true, toolCalls: 1 },
    });
    expect(scores.citationVerdicts.map((v) => [v.n, v.supports])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('reads the tool tags from the case when none are passed', async () => {
    const dataset = await prismaClient.evalDataset.create({ data: { name: 'core' } });
    const row = await prismaClient.evalCase.create({
      data: {
        datasetId: dataset.id,
        externalId: 'multi-005',
        question: 'q',
        expectedAnswer: 'a',
        expectedRefs: [],
        type: 'MULTI_HOP',
        split: 'DEV',
        tags: ['tool:find_callers'],
      },
    });
    const scores = await scoreAnswer(input({ caseId: row.id }), trajectory, { judge: false });
    expect(scores.trajectory).toMatchObject({
      expectedTools: ['find_callers'],
      expectedToolUsed: false,
    });
  });

  it('serves a repeated judgement from the cache, but not one with other passages', async () => {
    await scoreAnswer(input(), trajectory, { judge: true, tags: [] });
    const again = await scoreAnswer(input(), trajectory, { judge: true, tags: [] });
    expect(calls).toEqual(['correctness', 'grounding']);
    expect(again.judge.cached).toBe(2);
    expect(again.faithfulness).toBe(0.5);

    const changed = { ...book, text: 'Bloom filters are probabilistic sets.' };
    await scoreAnswer(input({ passages: [changed, code] }), trajectory, { judge: true, tags: [] });
    expect(calls).toEqual(['correctness', 'grounding', 'grounding']);
    expect(await prismaClient.evalJudgeCache.count()).toBe(3);
  });

  it('skips grounding past the input cap and leaves the metrics empty, not 0', async () => {
    const long = `${'The answer goes on about storage engines and their write paths. '.repeat(2_000)}[1]`;
    const scores = await scoreAnswer(input({ answer: long }), trajectory, {
      judge: true,
      tags: [],
    });
    expect(calls).toEqual(['correctness']);
    expect(scores.judge.skipped).toMatch(`over ${JUDGE_CAPS.inputTokens}`);
    expect(scores).toMatchObject({
      correctness: 0.5,
      faithfulness: null,
      citationPrecision: null,
      tainted: true,
    });
  });

  it('judges a multi-hop answer citing six full parent blocks', async () => {
    const parents = Array.from({ length: 6 }, (_, i): StoredPassage => ({
      ...code,
      n: i + 1,
      lineStart: 100 * i + 1,
      lineEnd: 100 * i + 90,
      text: `function step${i}(req, res, next) { return next(); } // handles part ${i}\n`.repeat(
        90,
      ),
    }));
    const answer = parents.map((p) => `Step ${p.n} hands the request on [${p.n}].`).join(' ');
    const scores = await scoreAnswer(
      input({ answer, passages: parents, citations: parents.map(checked) }),
      trajectory,
      { judge: true, tags: [] },
    );
    expect(calls).toEqual(['correctness', 'grounding']);
    expect(scores.judge.skipped).toBeNull();
    expect(scores.faithfulness).toBe(0.5);
  });

  it('marks a failed judge call as tainted with no score', async () => {
    judgeReplies({ grounding: apiError(400) });
    const scores = await scoreAnswer(input(), trajectory, { judge: true, tags: [] });
    expect(scores.judge.skipped).toMatch(/^grounding failed/);
    expect(scores).toMatchObject({ correctness: 0.5, faithfulness: null, tainted: true });
    // Computed metrics don't depend on the judge.
    expect(scores.citationRecall).toBe(1);
  });

  it('only grades correctness for a long-context answer', async () => {
    const scores = await scoreAnswer(
      input({ grounded: false, citations: [], passages: [] }),
      trajectory,
      { judge: true, tags: [] },
    );
    expect(calls).toEqual(['correctness']);
    expect(scores.judge.prompts).toEqual(['judge-correctness@v1']);
    expect(scores).toMatchObject({ correctness: 0.5, faithfulness: null, citationRecall: null });
  });

  it('counts a refusal on a NO_ANSWER case, without checking claims it never made', async () => {
    judgeReplies({ correctness: { grade: 'correct', declined: true, reason: 'Says so.' } });
    const scores = await scoreAnswer(
      input({
        type: 'NO_ANSWER',
        refs: [],
        answer: "Your sources don't cover WebSocket upgrades.",
        citations: [],
      }),
      trajectory,
      { judge: true, tags: [] },
    );
    expect(calls).toEqual(['correctness']);
    expect(scores).toMatchObject({
      correctness: 1,
      declined: true,
      noAnswerCorrect: true,
      citationRecall: null,
      tainted: false,
    });
  });

  it('falls back to the phrase check with the judge off', async () => {
    const scores = await scoreAnswer(
      input({
        type: 'NO_ANSWER',
        refs: [],
        answer: 'The sources do not cover gzip.',
        citations: [],
      }),
      trajectory,
      { judge: false, tags: [] },
    );
    expect(calls).toEqual([]);
    expect(scores).toMatchObject({
      correctness: null,
      noAnswerCorrect: true,
      tainted: false,
      judge: { skipped: 'judge off' },
    });
  });

  it('taints an answer whose model fell back', async () => {
    const scores = await scoreAnswer(
      input(),
      { ...trajectory, fallbackUsed: true },
      { judge: false, tags: [] },
    );
    expect(scores.tainted).toBe(true);
  });
});

describe('citationRecall', () => {
  it('only counts passages the answer cites', () => {
    expect(citationRecall(input({ citations: [checked(book)] }))).toBe(0.5);
    expect(citationRecall(input({ citations: [{ ...checked(code), valid: false }] }))).toBe(0);
  });

  it('matches a docs page by URL and heading', () => {
    const docs: StoredPassage = {
      n: 4,
      kind: 'CHUNK',
      sourceTitle: 'Routing',
      sourceKey: 'docs',
      path: 'https://expressjs.com/en/guide/routing.html',
      heading: 'Routing > Route paths',
      text: 'Route paths can be strings.',
    };
    const recall = citationRecall({
      refs: [
        {
          sourceKey: 'docs',
          url: 'https://expressjs.com/en/guide/routing.html',
          heading: 'Route paths',
        },
      ],
      citations: [checked(docs)],
      passages: [docs],
    });
    expect(recall).toBe(1);
  });
});

describe('judgeRelation', () => {
  it('tells the same model, the same provider and another provider apart', () => {
    const judge = 'google/gemini-3.5-flash-lite';
    expect(judgeRelation(judge, judge)).toEqual({ selfJudged: true, sameProvider: true });
    expect(judgeRelation('gemini-3.5-flash-lite', judge)).toEqual({
      selfJudged: true,
      sameProvider: true,
    });
    expect(judgeRelation('google/gemini-3.6-flash', judge)).toEqual({
      selfJudged: false,
      sameProvider: true,
    });
    expect(judgeRelation('groq/openai/gpt-oss-120b', judge)).toEqual({
      selfJudged: false,
      sameProvider: false,
    });
    expect(judgeRelation(null, judge)).toEqual({ selfJudged: false, sameProvider: false });
  });
});

describe('declinedByPhrase', () => {
  it('spots common refusals near the start only', () => {
    expect(declinedByPhrase("I couldn't find anything about HNSW in your sources.")).toBe(true);
    expect(declinedByPhrase('This is not covered by the book.')).toBe(true);
    expect(declinedByPhrase('Express sets the status to 302 by default [1].')).toBe(false);
    expect(declinedByPhrase(`${'x '.repeat(300)} not covered`)).toBe(false);
  });
});

describe('summarizeAnswers', () => {
  const scores = (overrides: Partial<AnswerScores> = {}): AnswerScores => ({
    correctness: 1,
    faithfulness: 1,
    citationPrecision: 1,
    citationRecall: 1,
    noAnswerCorrect: null,
    declined: false,
    claims: [],
    citationVerdicts: [],
    correctnessReason: null,
    trajectory: {
      expectedTools: [],
      expectedToolUsed: null,
      steps: 2,
      toolCalls: 2,
      redundantCalls: 0,
      toolErrors: 0,
      hitMaxSteps: false,
    },
    judge: { model: 'google/judge', prompts: [], cached: 0, skipped: null },
    tainted: false,
    covered: null,
    ...overrides,
  });
  const outcome = (overrides: Partial<AnswerOutcome> = {}): AnswerOutcome => ({
    type: 'BOOK',
    tags: [],
    reviewed: true,
    scores: scores(),
    error: false,
    latencyMs: 1_000,
    costUsd: 0.01,
    ...overrides,
  });

  it('averages measured metrics only and counts errors and taints apart', () => {
    const outcomes = [
      outcome(),
      outcome({
        latencyMs: 3_000,
        scores: scores({
          correctness: 0,
          faithfulness: null,
          tainted: true,
          trajectory: {
            expectedTools: ['trace_flow'],
            expectedToolUsed: false,
            steps: 5,
            toolCalls: 4,
            redundantCalls: 2,
            toolErrors: 1,
            hitMaxSteps: true,
          },
        }),
      }),
      outcome({ error: true, scores: null, latencyMs: 60_000, costUsd: 0.04 }),
      outcome({
        type: 'NO_ANSWER',
        reviewed: false,
        latencyMs: 2_000,
        scores: scores({ correctness: 1, noAnswerCorrect: true, citationRecall: null }),
      }),
    ];
    const m = answerMetrics(outcomes);
    expect(m).toMatchObject({
      cases: 4,
      errors: 1,
      tainted: 1,
      correctness: 2 / 3,
      faithfulness: 1,
      citationRecall: 1,
      noAnswerAccuracy: 1,
      expectedToolRate: 0,
      avgSteps: 3,
      redundantCallRate: 2 / 8,
      toolErrorRate: 1 / 8,
      maxStepsRate: 1 / 3,
      // Every case's cost, the failed one too; latency of finished answers only.
      p50LatencyMs: 2_000,
      p95LatencyMs: 3_000,
    });
    expect(m.costPerQueryUsd).toBeCloseTo(0.0175);

    const summary = summarizeAnswers(outcomes, { answerModel: 'google/gemini-3.6-flash' });
    expect(summary.byType.NO_ANSWER?.cases).toBe(1);
    expect(summary.byType.BOOK?.cases).toBe(3);
    expect(summary.reviewedOnly.cases).toBe(3);
    expect(summary.coveredOnly).toBeUndefined();
    expect(summary.selfJudged).toBe(false);
    // Gemini Flash answers, Gemini Flash-Lite judges.
    expect(summary.sameProviderJudge).toBe(true);
    expect(
      summarizeAnswers(outcomes, { answerModel: 'groq/openai/gpt-oss-120b' }).sameProviderJudge,
    ).toBe(false);
  });

  it('gives null rather than 0 when nothing was measured', () => {
    const m = answerMetrics([outcome({ error: true, scores: null })]);
    expect(m).toMatchObject({ correctness: null, p50LatencyMs: null, redundantCallRate: null });
  });

  it('adds covered-only metrics for long-context runs and spots a self-judged run', () => {
    const summary = summarizeAnswers(
      [
        outcome({ scores: scores({ covered: true, correctness: 1 }) }),
        outcome({ scores: scores({ covered: false, correctness: 0 }) }),
      ],
      { answerModel: JUDGE },
    );
    expect(summary.overall.correctness).toBe(0.5);
    expect(summary.coveredOnly).toMatchObject({ cases: 1, correctness: 1 });
    expect(summary.selfJudged).toBe(true);
    expect(summary.sameProviderJudge).toBe(true);
  });
});
