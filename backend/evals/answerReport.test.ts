import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { Prisma } from '../src/generated/prisma/client.js';
import type { EvalCaseType } from '../src/generated/prisma/enums.js';
import { textRoutes } from '../src/llm/models.js';
import { resetDb } from '../tests/helpers/db.js';
import type { AnswerScores, StoredAnswerContext, StoredTrajectory } from './answer.types.js';
import {
  answerModelOf,
  corpusOf,
  judgeOf,
  loadAnswerRuns,
  renderAnswerReport,
  writeAnswerReport,
  type AnswerReportRun,
} from './answerReport.js';

// Anything that quotes an answer, a claim, a passage or a judge's reason carries this marker;
// none of it may reach a committed report.
const LEAK = 'LEAKED-TEXT';

const judge = textRoutes.judge.primary;
const JUDGE_ID = `${judge.provider}/${judge.model}`;

const cases: { id: string; type: EvalCaseType }[] = [
  { id: 'book-001', type: 'BOOK' },
  { id: 'code-001', type: 'CODE' },
  { id: 'multi-005', type: 'MULTI_HOP' },
  { id: 'none-001', type: 'NO_ANSWER' },
];

function scores(correctness: number, overrides: Partial<AnswerScores> = {}): AnswerScores {
  return {
    correctness,
    faithfulness: 0.75,
    citationPrecision: 1,
    citationRecall: 0.5,
    noAnswerCorrect: null,
    declined: false,
    claims: [{ claim: `${LEAK} claim`, cited: [1], supported: true, reason: `${LEAK} why` }],
    citationVerdicts: [{ n: 1, supports: true, reason: `${LEAK} verdict` }],
    correctnessReason: `${LEAK} reason`,
    trajectory: {
      expectedTools: ['trace_flow'],
      expectedToolUsed: true,
      steps: 3,
      toolCalls: 2,
      redundantCalls: 0,
      toolErrors: 0,
      hitMaxSteps: false,
    },
    judge: { model: `google/${judge.model}`, prompts: [], cached: 0, skipped: null },
    tainted: false,
    covered: null,
    ...overrides,
  };
}

function run(
  name: string,
  correctness: number,
  {
    model = 'google/gemini-3.6-flash',
    longContext = false,
    limit = undefined as number | undefined,
    corpus = 'context',
    judgeId = JUDGE_ID,
  } = {},
): AnswerReportRun {
  const runId = `run-${name}`;
  return {
    id: runId,
    datasetId: 'dataset',
    suite: 'answer',
    name,
    config: { name, selection: { split: 'DEV', limit }, corpus: { variant: corpus } },
    gitSha: 'abc123',
    promptVersions: [],
    models: { answer: model, judge: judgeId },
    split: 'DEV',
    status: 'DONE',
    startedAt: new Date(),
    finishedAt: new Date(),
    summary: null,
    costUsd: new Prisma.Decimal(0),
    notes: null,
    results: cases.map((item, index) => {
      const context: StoredAnswerContext = {
        passages: [
          {
            n: 1,
            kind: 'CHUNK',
            sourceTitle: 'Book',
            sourceKey: 'book',
            pageStart: 99,
            pageEnd: 99,
            text: `${LEAK} passage`,
          },
        ],
        ...(longContext
          ? {
              longContext: {
                tokens: 120_000,
                kept: {
                  book: { tokens: 60_000, total: 300_000 },
                  repo: { tokens: 50_000, total: 50_000 },
                },
                // The book case's page was cut off.
                refsCovered:
                  item.type === 'BOOK' ? [false] : item.type === 'NO_ANSWER' ? [] : [true],
              },
            }
          : {}),
      };
      const trajectory: StoredTrajectory = {
        calls: [
          {
            step: 1,
            tool: 'search_sources',
            args: { query: `${LEAK} query` },
            ok: true,
            summary: `${LEAK}`,
            ms: 5,
            resultTokens: 9,
          },
        ],
        steps: 2,
        forcedFinal: false,
        staticRag: name === 'static-rag',
        model,
        fallbackUsed: false,
        promptId: 'agent-system@v1',
        status: 'COMPLETE',
      };
      return {
        id: `${runId}-${index}`,
        runId,
        caseId: `case-${item.id}`,
        retrieved: context as unknown as Prisma.JsonValue,
        answer: `${LEAK} answer`,
        citations: [],
        toolTrajectory: trajectory as unknown as Prisma.JsonValue,
        scores: scores(item.type === 'BOOK' ? 0 : correctness, {
          noAnswerCorrect: item.type === 'NO_ANSWER' ? true : null,
        }) as unknown as Prisma.JsonValue,
        latencyMs: 1_000 * (index + 1),
        tokensIn: 100,
        tokensOut: 50,
        costUsd: new Prisma.Decimal(0.002),
        error: null,
        createdAt: new Date(),
        case: {
          id: `case-${item.id}`,
          datasetId: 'dataset',
          externalId: item.id,
          question: `${LEAK} question`,
          expectedAnswer: `${LEAK} expected`,
          expectedRefs: [],
          type: item.type,
          split: 'DEV',
          tags: [],
          reviewed: true,
          retired: false,
          origin: 'MANUAL',
          memories: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
    }),
  };
}

describe('renderAnswerReport', () => {
  const runs = [
    run('static-rag', 0.5),
    run('adaptive-agent', 1),
    run('model-gpt-oss-120b', 0.5, { model: 'groq/openai/gpt-oss-120b', limit: 10 }),
    run('model-judge', 1, { model: `${judge.provider}/${judge.model}` }),
    run('long-context', 0.5, { longContext: true }),
  ];
  const report = renderAnswerReport(runs, new Date('2026-10-25T00:00:00Z'));

  it('never quotes answers, claims, passages, questions or judge reasons', () => {
    expect(report).not.toContain(LEAK);
  });

  it('has the comparison sections', () => {
    expect(report).toContain('# Answer evals, 2026-10-25');
    expect(report).toContain('## Static RAG vs adaptive agent');
    expect(report).toContain('## Model comparison');
    expect(report).toContain('## Long context vs RAG (long-context)');
    expect(report).toContain('## Lowest-scoring cases of adaptive-agent');
  });

  it('marks self-judged, same-provider judged and limited runs, and says why', () => {
    const row = (name: string) =>
      report.split('\n').find((line) => line.startsWith(`| ${name} |`))!;
    expect(row('model-judge')).toContain('self-judged');
    expect(row('model-gpt-oss-120b')).toContain('limit 10');
    expect(row('model-gpt-oss-120b')).not.toContain('judge');
    // Gemini Flash answers, Gemini Flash-Lite judges.
    expect(row('adaptive-agent')).toContain('same-provider judge');
    expect(row('adaptive-agent')).not.toContain('self-judged');
    expect(report).toContain('a judge tends to rate its own model family higher');
  });

  it('names the corpus and the judge stored with the runs', () => {
    const old = renderAnswerReport([
      run('adaptive-agent', 1, { judgeId: 'groq/old-judge', corpus: 'nocontext' }),
    ]);
    expect(old).toContain('corpus nocontext · judge groq/old-judge');
    expect(old).not.toContain(JUDGE_ID);
    expect(old).not.toContain('same-provider judge');
  });

  it('never sets runs from different corpora or judges side by side', () => {
    const mixed = renderAnswerReport([
      run('static-rag', 0.5),
      run('adaptive-agent', 1, { corpus: 'nocontext' }),
      run('model-a', 1, { judgeId: 'groq/old-judge' }),
    ]);
    expect(mixed).toContain('3 runs in 3 groups by corpus and judge');
    expect(mixed).toContain(`## Corpus context, judge ${JUDGE_ID}`);
    expect(mixed).toContain(`## Corpus nocontext, judge ${JUDGE_ID}`);
    expect(mixed).toContain('## Corpus context, judge groq/old-judge');
    expect(mixed).toContain('### Results');
    expect(mixed).not.toContain('Static RAG vs adaptive agent');
  });

  it('falls back to the judge in the scores and to the context corpus', () => {
    const bare = { ...run('adaptive-agent', 1), models: {}, config: {} };
    expect(judgeOf(bare)).toBe(`google/${judge.model}`);
    expect(corpusOf(bare)).toBe('context');
  });

  it('compares static and adaptive by type on shared cases', () => {
    // CODE: 0.5 → 1.
    expect(report).toMatch(/\| CODE \| 1 \| 0\.500 \| 1\.000 \| \+0\.500 \|/);
  });

  it('reports long context on all cases and on the ones whose refs fit', () => {
    expect(report).toContain('book 20% of 300000 tokens, repo 100% of 50000 tokens');
    // All 4 cases: the book case scored 0; the other 3 have their refs inside the prompt.
    expect(report).toMatch(/\| long-context, all cases \| 4 \| 0\.375 \|/);
    expect(report).toMatch(/\| long-context, refs in the prompt \| 3 \| 0\.500 \|/);
    expect(report).toMatch(/\| adaptive-agent, refs in the prompt \| 3 \| 1\.000 \|/);
  });

  it('names the model that answered most cases', () => {
    expect(answerModelOf(runs[2]!)).toBe('groq/openai/gpt-oss-120b');
  });

  it('says so when there is nothing to report', () => {
    expect(renderAnswerReport([])).toContain('No finished runs.');
  });
});

describe('loadAnswerRuns and writeAnswerReport', () => {
  it("picks one corpus and the newest run's judge", async () => {
    await resetDb();
    const dataset = await prismaClient.evalDataset.create({ data: { name: 'core' } });
    const create = (name: string, startedAt: number, corpus: string, judgeId: string) =>
      prismaClient.evalRun.create({
        data: {
          datasetId: dataset.id,
          suite: 'answer',
          name,
          status: 'DONE',
          gitSha: 'abc',
          split: 'DEV',
          startedAt: new Date(startedAt),
          config: { corpus: { variant: corpus } },
          models: { judge: judgeId },
        },
      });
    await create('static-rag', 1_000, 'context', 'groq/old-judge');
    const adaptive = await create('adaptive-agent', 2_000, 'context', JUDGE_ID);
    const staticNow = await create('static-rag', 3_000, 'context', JUDGE_ID);
    const nocontext = await create('adaptive-agent', 4_000, 'nocontext', JUDGE_ID);
    await create('model-x', 500, 'context', 'groq/old-judge');

    const runs = await loadAnswerRuns();
    expect(runs.map((r) => r.id)).toEqual([adaptive.id, staticNow.id]);
    expect((await loadAnswerRuns(undefined, { corpus: 'nocontext' })).map((r) => r.id)).toEqual([
      nocontext.id,
    ]);
    expect(await loadAnswerRuns(undefined, { corpus: 'gate' })).toEqual([]);
  });

  it('takes the latest finished answer run per config and writes latest-answer.md', async () => {
    await resetDb();
    const dataset = await prismaClient.evalDataset.create({ data: { name: 'core' } });
    const base = { datasetId: dataset.id, config: {}, gitSha: 'abc', split: 'DEV' as const };
    await prismaClient.evalRun.create({
      data: {
        ...base,
        suite: 'answer',
        name: 'adaptive-agent',
        status: 'DONE',
        startedAt: new Date(1_000),
      },
    });
    const latest = await prismaClient.evalRun.create({
      data: {
        ...base,
        suite: 'answer',
        name: 'adaptive-agent',
        status: 'DONE',
        startedAt: new Date(2_000),
      },
    });
    await prismaClient.evalRun.create({
      data: { ...base, suite: 'answer', name: 'static-rag', status: 'RUNNING' },
    });
    const retrieval = await prismaClient.evalRun.create({
      data: { ...base, suite: 'retrieval', name: 'hybrid', status: 'DONE' },
    });

    const runs = await loadAnswerRuns();
    expect(runs.map((r) => r.id)).toEqual([latest.id]);
    await expect(loadAnswerRuns([retrieval.id])).rejects.toThrow('not an answer run');

    const dir = await mkdtemp(join(tmpdir(), 'answer-report-'));
    try {
      const file = await writeAnswerReport(runs, dir, new Date('2026-10-25T00:00:00Z'));
      expect(file).toBe(join(dir, '2026-10-25-answer-dev.md'));
      expect(await readFile(join(dir, 'latest-answer.md'), 'utf8')).toContain('adaptive-agent');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
