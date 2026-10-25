import { randomUUID } from 'node:crypto';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { resetCircuitBreaker } from '../src/llm/circuitBreaker.js';
import { textRoutes } from '../src/llm/models.js';
import { DEFAULT_AGENT_PROMPT } from '../src/llm/prompts/agentSystem.js';
import { addMemory, purgeMemories } from '../src/modules/memory/memory.service.js';
import { resetDb } from '../tests/helpers/db.js';
import {
  scriptedModel,
  streamingModel,
  useModels,
  type StreamTurn,
} from '../tests/helpers/llm-mock.js';
import { seedSource, vectorOf } from '../tests/helpers/retrieval.js';
import { answerConfigSchema, type AnswerConfig } from './answerConfig.js';
import type { AnswerScores, JudgeInput, StoredAnswerContext } from './answer.types.js';
import { runAnswers } from './answerSuite.js';
import { loadCorpus } from './corpusWorkspace.js';
import { evalCaseSchema, importCases } from './dataset.js';
import { refsCovered, shareBudget } from './longContext.js';
import { scoreAnswer, summarizeAnswers } from './scorers/answer.js';

vi.mock('../src/llm/providers.js', () => import('../tests/helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('../tests/helpers/no-pacing.js'));
vi.mock('./corpusWorkspace.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./corpusWorkspace.js')>()),
  loadCorpus: vi.fn(),
}));
vi.mock('./scorers/answer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./scorers/answer.js')>()),
  scoreAnswer: vi.fn(),
  summarizeAnswers: vi.fn(),
}));
vi.mock('../src/modules/memory/memory.service.js', () => ({
  addMemory: vi.fn(),
  purgeMemories: vi.fn(async () => 0),
}));
// What the seeded memories would turn into, so the test can see them reach the prompt.
const seeded: string[] = [];
vi.mock('../src/modules/memory/memory.recall.js', () => ({
  memoryBlock: vi.fn(async ({ enabled }: { enabled: boolean }) =>
    enabled && seeded.length > 0 ? `<memory>\n${seeded.join('\n')}\n</memory>` : '(nothing yet)',
  ),
}));

const AGENT = textRoutes.agent.primary.model;
const PASSAGE = 'A salt is random data mixed into each password before hashing it.';
const search = { name: 'search_sources', input: { query: 'what is a salt' } };

const cases = [
  {
    id: 'book-001',
    type: 'BOOK',
    split: 'DEV',
    question: 'What is a salt?',
    expectedAnswer: 'Random data mixed into each password before hashing.',
    expectedRefs: [{ sourceKey: 'book', pageStart: 1, pageEnd: 1 }],
    reviewed: true,
  },
  {
    id: 'none-001',
    type: 'NO_ANSWER',
    split: 'DEV',
    question: 'How do I deploy to the moon?',
    expectedAnswer: 'The sources do not say.',
    expectedRefs: [],
  },
  {
    id: 'personal-001',
    type: 'BOOK',
    split: 'DEV',
    question: 'Which of these fits the way my project stores passwords?',
    expectedAnswer: 'Salting each password before hashing it.',
    expectedRefs: [{ sourceKey: 'book', pageStart: 1, pageEnd: 1 }],
    tags: ['personal'],
    memories: [{ kind: 'FACT', content: 'The user hashes passwords with bcrypt in their app.' }],
  },
].map((item) => evalCaseSchema.parse(item));

const config = (fields: Partial<AnswerConfig> & { name: string }) =>
  answerConfigSchema.parse({ gapMs: 0, ...fields });

const scores = (input: JudgeInput): AnswerScores => ({
  correctness: input.type === 'NO_ANSWER' ? null : 1,
  faithfulness: 1,
  citationPrecision: 1,
  citationRecall: 1,
  noAnswerCorrect: input.type === 'NO_ANSWER' ? true : null,
  declined: input.type === 'NO_ANSWER',
  claims: [],
  citationVerdicts: [],
  correctnessReason: null,
  trajectory: {
    expectedTools: [],
    expectedToolUsed: null,
    steps: 1,
    toolCalls: 0,
    redundantCalls: 0,
    toolErrors: 0,
    hitMaxSteps: false,
  },
  judge: { model: 'google/judge', prompts: [], cached: 0, skipped: null },
  tainted: false,
  covered: null,
});

let userId: string;
let workspaceId: string;
let bookId: string;

beforeEach(async () => {
  await resetDb();
  resetCircuitBreaker();
  seeded.length = 0;
  vi.mocked(scoreAnswer)
    .mockReset()
    .mockImplementation(async (input) => scores(input));
  vi.mocked(summarizeAnswers)
    .mockReset()
    .mockReturnValue({ overall: {} } as never);
  vi.mocked(purgeMemories).mockClear();
  vi.mocked(addMemory)
    .mockReset()
    .mockImplementation(async (_user, memory) => {
      seeded.push(memory.content);
      return {} as never;
    });
  vi.mocked(purgeMemories).mockImplementation(async () => {
    seeded.length = 0;
    return 0;
  });

  const user = await prismaClient.user.create({
    data: { id: randomUUID(), name: 'Eval', email: 'eval@example.com', isSystem: true },
  });
  userId = user.id;
  const workspace = await prismaClient.workspace.create({ data: { userId, name: 'eval-core' } });
  workspaceId = workspace.id;
  ({ sourceId: bookId } = await seedSource(workspaceId, {
    title: 'Security Book',
    chunks: { salt: { content: PASSAGE, vector: vectorOf(1) } },
  }));
  vi.mocked(loadCorpus).mockResolvedValue({
    userId,
    workspaceId,
    corpusVersion: 'v1',
    sources: [{ sourceKey: 'book', sourceId: bookId, type: 'PDF', status: 'READY' }],
  });
  await importCases('core', cases);
});

const play = (turns: StreamTurn[]) => {
  const model = streamingModel(turns);
  useModels({ [AGENT]: model });
  return model;
};

const results = async (runId: string) => {
  const rows = await prismaClient.evalResult.findMany({
    where: { runId },
    include: { case: true },
    orderBy: { case: { externalId: 'asc' } },
  });
  return new Map(rows.map((row) => [row.case.externalId, row]));
};

const toolNames = (call: { tools?: { name: string }[] }) => call.tools?.map((tool) => tool.name);

describe('answer suite', () => {
  it('answers each case through the chat pipeline and stores what the judge needs', async () => {
    play([
      { toolCalls: [search] },
      { text: 'A salt is random data mixed into each password [1].' },
      { text: "The sources don't cover deploying to the moon." },
    ]);

    const { runId } = await runAnswers({
      dataset: 'core',
      config: config({ name: 'adaptive-agent' }),
      split: 'DEV',
    });

    const run = await prismaClient.evalRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ suite: 'answer', name: 'adaptive-agent', status: 'DONE' });
    expect(run.models).toMatchObject({ answer: `google/${AGENT}` });
    const byId = await results(runId);
    // The personal case needs its memories, so only memory configs run it.
    expect([...byId.keys()]).toEqual(['book-001', 'none-001']);

    const book = byId.get('book-001')!;
    expect(book.error).toBeNull();
    expect(book.answer).toBe('A salt is random data mixed into each password [1].');
    expect(book.citations).toEqual([expect.objectContaining({ n: 1, valid: true })]);
    const context = book.retrieved as unknown as StoredAnswerContext;
    expect(context.passages).toEqual([
      expect.objectContaining({ n: 1, sourceKey: 'book', sourceId: bookId, text: PASSAGE }),
    ]);
    expect(book.toolTrajectory).toMatchObject({
      calls: [expect.objectContaining({ tool: 'search_sources', ok: true, step: 1 })],
      staticRag: false,
      forcedFinal: false,
      model: `google/${AGENT}`,
      promptId: DEFAULT_AGENT_PROMPT,
      status: 'COMPLETE',
    });
    expect(book.tokensIn).toBe(200);
    expect(book.scores).toMatchObject({ correctness: 1, covered: null });

    expect(scoreAnswer).toHaveBeenCalledTimes(2);
    const [input, trajectory, options] = vi.mocked(scoreAnswer).mock.calls[0]!;
    expect(input).toMatchObject({ caseId: book.caseId, grounded: true, type: 'BOOK' });
    expect(input.refs).toEqual([{ sourceKey: 'book', pageStart: 1, pageEnd: 1 }]);
    expect(trajectory.steps).toBe(2);
    expect(options).toMatchObject({ judge: true, tags: [] });

    // Each case is a conversation of its own, and the eval user gets no titles or memories.
    expect(await prismaClient.conversation.count({ where: { userId } })).toBe(2);
    expect(summarizeAnswers).toHaveBeenCalledWith(expect.any(Array), {
      answerModel: `google/${AGENT}`,
    });
  });

  it('searches once with the question in static RAG, then answers without tools', async () => {
    const model = play([{ text: 'A salt is random data [1].' }]);

    const { runId } = await runAnswers({
      dataset: 'core',
      config: config({ name: 'static-rag', mode: 'static' }),
      split: 'DEV',
      limit: 1,
    });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]!.tools).toBeUndefined();
    const book = (await results(runId)).get('book-001')!;
    expect(book.toolTrajectory).toMatchObject({
      calls: [
        expect.objectContaining({ tool: 'search_sources', args: { query: 'What is a salt?' } }),
      ],
      staticRag: true,
      forcedFinal: false,
    });
    expect(book.citations).toEqual([expect.objectContaining({ n: 1, valid: true })]);
  });

  it('gives the agent only the config tools, and never the web', async () => {
    const model = play([{ text: 'Nothing found.' }]);

    await runAnswers({
      dataset: 'core',
      config: config({ name: 'vectorless-only', tools: ['search_code', 'read_source'] }),
      split: 'DEV',
      limit: 1,
    });
    expect(toolNames(model.doStreamCalls[0]! as never)).toEqual(['search_code', 'read_source']);

    const all = play([{ text: 'Nothing found.' }]);
    await runAnswers({
      dataset: 'core',
      config: config({ name: 'adaptive-agent' }),
      split: 'DEV',
      limit: 1,
    });
    expect(toolNames(all.doStreamCalls[0]! as never)).not.toContain('web_search');
    expect(answerConfigSchema.safeParse({ name: 'x', tools: ['web_search'] }).success).toBe(false);
  });

  it('pins the config model with no fallback and records the run when it fails', async () => {
    const pinned = streamingModel([new Error('quota')]);
    const fallback = streamingModel([{ text: 'should not answer' }]);
    useModels({ 'openai/gpt-oss-20b': pinned, [textRoutes.agent.fallback!.model]: fallback });

    const { runId } = await runAnswers({
      dataset: 'core',
      config: config({
        name: 'model-gpt-oss-20b-6k5',
        model: { provider: 'groq', model: 'openai/gpt-oss-20b' },
        maxInputTokens: 6_500,
      }),
      split: 'DEV',
      limit: 1,
    });

    expect(fallback.doStreamCalls).toHaveLength(0);
    const book = (await results(runId)).get('book-001')!;
    expect(book.error).toBeTruthy();
    expect(book.scores).toEqual({});
    expect(scoreAnswer).not.toHaveBeenCalled();
  });

  it('reruns only the failed cases on resume, and refuses a changed config', async () => {
    play([new Error('quota')]);
    const adaptive = config({ name: 'adaptive-agent' });
    const first = await runAnswers({ dataset: 'core', config: adaptive, split: 'DEV' });
    const firstResults = await results(first.runId);
    expect([...firstResults.values()].every((row) => row.error !== null)).toBe(true);

    await expect(
      runAnswers({
        dataset: 'core',
        config: { ...adaptive, timeoutMs: 5_000 },
        split: 'DEV',
        resume: first.runId,
      }),
    ).rejects.toThrow(/config has changed/);

    const model = play([{ text: 'Answered this time.' }]);
    const resumed = await runAnswers({
      dataset: 'core',
      config: adaptive,
      split: 'DEV',
      resume: first.runId,
    });
    expect(resumed.runId).toBe(first.runId);
    expect(model.doStreamCalls).toHaveLength(2);
    const rows = await results(first.runId);
    expect(rows.size).toBe(2);
    expect([...rows.values()].every((row) => row.error === null)).toBe(true);
  });

  it("seeds a personal case's memories, shows them to the agent and removes them after", async () => {
    const model = play([{ text: 'Salting fits your bcrypt setup [1].' }]);

    await runAnswers({
      dataset: 'core',
      config: config({
        name: 'memory-on',
        useMemory: true,
        tags: ['personal'],
        excludeTags: [],
      }),
      split: 'DEV',
    });

    expect(addMemory).toHaveBeenCalledWith(userId, {
      kind: 'FACT',
      content: 'The user hashes passwords with bcrypt in their app.',
      importance: 3,
    });
    const system = JSON.stringify(model.doStreamCalls[0]!.prompt[0]);
    expect(system).toContain('The user hashes passwords with bcrypt');
    // Purged when the run starts, before the case is seeded and once it is done.
    expect(purgeMemories).toHaveBeenCalledTimes(3);
    expect(seeded).toEqual([]);
  });

  it('keeps memory out of configs that are not about it', async () => {
    const model = play([{ text: 'Answer.' }]);
    seeded.push('left over from another run');

    await runAnswers({
      dataset: 'core',
      config: config({ name: 'memory-off', tags: ['personal'], excludeTags: [] }),
      split: 'DEV',
    });

    expect(addMemory).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt[0])).not.toContain('left over');
  });
});

describe('answer suite steps', () => {
  it('runs a case in a process that did not start the run, from what the run stored', async () => {
    const { answerSuite } = await import('./answerSuite.js');
    const { runId, caseIds, gapMs } = await answerSuite.start({
      dataset: 'core',
      config: 'adaptive-agent',
      split: 'DEV',
      limit: 1,
    });
    expect(caseIds).toHaveLength(1);
    expect(gapMs).toBeGreaterThan(0);

    // A worker step in another process: fresh modules, nothing kept in memory.
    vi.resetModules();
    const fresh = await import('./answerSuite.js');
    const mocks = await import('../tests/helpers/llm-mock.js');
    mocks.useModels({ [AGENT]: mocks.streamingModel([{ text: 'A salt is random data.' }]) });
    const { line } = await fresh.answerSuite.runCase(runId, caseIds[0]!);
    expect(line).toMatch(/^book-001 /);
    // A retried step leaves a stored case alone.
    expect((await fresh.answerSuite.runCase(runId, caseIds[0]!)).line).toMatch(/already done/);
    await fresh.answerSuite.finish(runId);

    const run = await prismaClient.evalRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('DONE');
    expect(await prismaClient.evalResult.count({ where: { runId, error: null } })).toBe(1);
  });
});

const usageRow = (task: string, costUsd: number, type: 'LLM' | 'EMBEDDING' = 'LLM') =>
  prismaClient.usageEvent.create({
    data: {
      userId,
      type,
      task,
      provider: 'google',
      model: 'mock',
      tokensIn: 0,
      tokensOut: 0,
      costUsd,
      latencyMs: 1,
      ok: true,
    },
  });

const runCost = async (runId: string) =>
  (await prismaClient.evalRun.findUniqueOrThrow({ where: { id: runId } })).costUsd.toNumber();

describe('answer suite review fixes', () => {
  it('judges a stored answer again after a judge call failed, without asking it again', async () => {
    const model = play([{ text: 'A salt is random data [1].' }]);
    const failedJudge = (input: JudgeInput) => {
      const result = scores(input);
      result.correctness = null;
      result.judge.skipped = 'correctness failed: quota';
      result.tainted = true;
      return result;
    };
    vi.mocked(scoreAnswer).mockImplementation(async (input) => failedJudge(input));
    const adaptive = config({ name: 'adaptive-agent' });
    const first = await runAnswers({ dataset: 'core', config: adaptive, split: 'DEV' });
    expect(model.doStreamCalls).toHaveLength(2);

    vi.mocked(scoreAnswer).mockImplementation(async (input) => scores(input));
    await runAnswers({ dataset: 'core', config: adaptive, split: 'DEV', resume: first.runId });

    // Only the judge ran again, on the stored answers.
    expect(model.doStreamCalls).toHaveLength(2);
    expect(scoreAnswer).toHaveBeenCalledTimes(4);
    expect(vi.mocked(scoreAnswer).mock.calls[2]![0].answer).toBe('A salt is random data [1].');
    const book = (await results(first.runId)).get('book-001')!;
    expect(book.scores).toMatchObject({ correctness: 1, tainted: false });
  });

  it('leaves a deliberate judge skip alone', async () => {
    const model = play([{ text: 'Answer.' }]);
    vi.mocked(scoreAnswer).mockImplementation(async (input) => {
      const result = scores(input);
      result.judge.skipped = 'judge off';
      return result;
    });
    const off = config({ name: 'adaptive-agent', judge: false });
    const first = await runAnswers({ dataset: 'core', config: off, split: 'DEV' });
    await runAnswers({ dataset: 'core', config: off, split: 'DEV', resume: first.runId });

    expect(model.doStreamCalls).toHaveLength(2);
    expect(scoreAnswer).toHaveBeenCalledTimes(2);
  });

  it('refuses a step on other code than the run started with, in both suites', async () => {
    play([{ text: 'Answer.' }]);
    const { answerSuite } = await import('./answerSuite.js');
    const { runId, caseIds } = await answerSuite.start({
      dataset: 'core',
      config: 'adaptive-agent',
      split: 'DEV',
      limit: 1,
    });
    await prismaClient.evalRun.update({ where: { id: runId }, data: { gitSha: 'older' } });

    vi.resetModules();
    const fresh = await import('./answerSuite.js');
    await expect(fresh.answerSuite.runCase(runId, caseIds[0]!)).rejects.toThrow(
      /ran on code older/,
    );

    const dataset = await prismaClient.evalDataset.findUniqueOrThrow({ where: { name: 'core' } });
    const retrieval = await prismaClient.evalRun.create({
      data: {
        datasetId: dataset.id,
        suite: 'retrieval',
        name: 'hybrid',
        config: {
          name: 'hybrid',
          search: { mode: 'hybrid', rerank: false },
          corpus: { variant: 'context', corpusVersion: 'v1' },
        },
        gitSha: 'older',
        split: 'DEV',
      },
    });
    const { retrievalSuite } = await import('./retrievalSuite.js');
    await expect(retrievalSuite.runCase(retrieval.id, caseIds[0]!)).rejects.toThrow(
      /ran on code older/,
    );
  });

  it("counts the judge's calls, not other calls made meanwhile", async () => {
    play([{ text: 'Answer.' }]);
    vi.mocked(scoreAnswer).mockImplementation(async (input) => {
      await usageRow('judge', 0.01);
      await usageRow('cheap', 5);
      return scores(input);
    });

    const { runId } = await runAnswers({
      dataset: 'core',
      config: config({ name: 'adaptive-agent' }),
      split: 'DEV',
      limit: 1,
    });

    // The answer's own calls, plus the judge's 0.01; the other call made meanwhile isn't it.
    const answerCost = (await prismaClient.evalResult.findFirstOrThrow({ where: { runId } }))
      .costUsd;
    expect(await runCost(runId)).toBeCloseTo(answerCost.toNumber() + 0.01, 6);
  });

  it('counts the embeddings of seeding and recalling memories toward the case', async () => {
    play([{ text: 'Answer.' }]);
    vi.mocked(addMemory).mockImplementation(async (_user, memory) => {
      seeded.push(memory.content);
      await usageRow('embed', 0.002, 'EMBEDDING');
      return {} as never;
    });

    const { runId } = await runAnswers({
      dataset: 'core',
      config: config({ name: 'memory-on', useMemory: true, tags: ['personal'], excludeTags: [] }),
      split: 'DEV',
    });

    const personal = (await results(runId)).get('personal-001')!;
    const turn = await prismaClient.message.findFirstOrThrow({ where: { role: 'ASSISTANT' } });
    expect(personal.costUsd.toNumber()).toBeCloseTo(turn.costUsd.toNumber() + 0.002, 6);
    expect(await runCost(runId)).toBeCloseTo(personal.costUsd.toNumber(), 6);
  });

  it('includes case tags in the cases hash, so a resume sees them change', async () => {
    play([{ text: 'Answer.' }]);
    const adaptive = config({ name: 'adaptive-agent' });
    const { runId } = await runAnswers({ dataset: 'core', config: adaptive, split: 'DEV' });

    await importCases('core', [{ ...cases[0]!, tags: ['tool:browse_toc'] }, ...cases.slice(1)]);

    await expect(
      runAnswers({ dataset: 'core', config: adaptive, split: 'DEV', resume: runId }),
    ).rejects.toThrow(/cases have changed/);
  });
});

describe('long context', () => {
  async function seedCorpusText() {
    const pages = ['Page one is about salts.', 'Page two is about peppers.', 'x '.repeat(900)];
    const pdf = await prismaClient.source.create({
      data: {
        workspaceId,
        type: 'PDF',
        title: 'Security Book',
        status: 'READY',
        origin: {},
        dedupeKey: `pdf:${randomUUID()}`,
      },
    });
    await prismaClient.sourceDocument.create({
      data: {
        id: randomUUID(),
        sourceId: pdf.id,
        path: 'book.pdf',
        content: pages.join('\f'),
        pageStart: 1,
        pageEnd: 3,
        sizeBytes: 1,
        hash: 'h',
      },
    });
    const repo = await prismaClient.source.create({
      data: {
        workspaceId,
        type: 'GITHUB_REPO',
        title: 'app',
        status: 'READY',
        origin: {},
        dedupeKey: `repo:${randomUUID()}`,
      },
    });
    for (const [path, content] of [
      ['lib/router.js', 'function match(path) { return true; }'],
      ['lib/big.js', 'y '.repeat(900)],
    ] as const) {
      await prismaClient.sourceDocument.create({
        data: { id: randomUUID(), sourceId: repo.id, path, content, sizeBytes: 1, hash: 'h' },
      });
    }
    vi.mocked(loadCorpus).mockResolvedValue({
      userId,
      workspaceId,
      corpusVersion: 'v1',
      sources: [
        { sourceKey: 'book', sourceId: pdf.id, type: 'PDF', status: 'READY' },
        { sourceKey: 'repo', sourceId: repo.id, type: 'GITHUB_REPO', status: 'READY' },
      ],
    });
  }

  it('answers from the cut corpus text and records which refs were in the prompt', async () => {
    await seedCorpusText();
    await importCases('core', [
      cases[0]!,
      evalCaseSchema.parse({
        id: 'book-003',
        type: 'BOOK',
        split: 'DEV',
        question: 'What is on page three?',
        expectedAnswer: 'Filler.',
        expectedRefs: [{ sourceKey: 'book', pageStart: 3, pageEnd: 3 }],
      }),
    ]);
    const model = scriptedModel(['Salts are random data (p. 1).']);
    useModels({ [textRoutes.longContext.primary.model]: model });

    const { runId } = await runAnswers({
      dataset: 'core',
      config: config({ name: 'long-context', mode: 'longContext', maxContextTokens: 1_000 }),
      split: 'DEV',
    });

    // Built once for the run: every case got the same prompt, without the big page and file.
    expect(model.doGenerateCalls).toHaveLength(2);
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain('Page one is about salts.');
    expect(prompt).toContain('lib/router.js');
    expect(prompt).not.toContain('lib/big.js');
    expect(prompt).not.toContain('[page 3]');

    const rows = await results(runId);
    const covered = (id: string) =>
      (rows.get(id)!.retrieved as unknown as StoredAnswerContext).longContext!.refsCovered;
    expect(covered('book-001')).toEqual([true]);
    expect(covered('book-003')).toEqual([false]);
    expect(rows.get('book-001')!.scores).toMatchObject({ covered: true });
    expect(rows.get('book-003')!.scores).toMatchObject({ covered: false });
    expect(rows.get('book-001')!.toolTrajectory).toMatchObject({
      calls: [],
      promptId: 'long-context-answer@v1',
    });
    expect(vi.mocked(scoreAnswer).mock.calls[0]![0]).toMatchObject({
      grounded: false,
      passages: [],
    });
  });

  it('keeps what a failed call was billed', async () => {
    await seedCorpusText();
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        // The provider billed the request, then the answer broke off.
        await usageRow('longContext', 0.03);
        throw new Error('connection reset');
      },
    });
    useModels({ [textRoutes.longContext.primary.model]: failing });

    const { runId } = await runAnswers({
      dataset: 'core',
      config: config({ name: 'long-context', mode: 'longContext', maxContextTokens: 1_000 }),
      split: 'DEV',
      limit: 1,
    });

    const book = (await results(runId)).get('book-001')!;
    expect(book.error).toBeTruthy();
    expect(book.costUsd.toNumber()).toBeGreaterThanOrEqual(0.03);
  });

  it('gives a small source all it needs and splits the rest', () => {
    expect(shareBudget({ docs: 100, book: 10_000, repo: 5_000 }, 3_100)).toEqual({
      docs: 100,
      repo: 1_500,
      book: 1_500,
    });
    expect(shareBudget({ docs: 100, repo: 500 }, 10_000)).toEqual({ docs: 100, repo: 500 });
  });

  it('counts a ref as covered only when all of it was kept', () => {
    const keptUnits = new Set([
      'book:1',
      'book:2',
      'repo:lib/router.js',
      'docs:https://expressjs.com/en/guide/routing',
    ]);
    expect(
      refsCovered({ keptUnits }, [
        { sourceKey: 'book', pageStart: 1, pageEnd: 2 },
        { sourceKey: 'book', pageStart: 2, pageEnd: 3 },
        { sourceKey: 'repo', path: './lib/router.js', lineStart: 1, lineEnd: 5 },
        { sourceKey: 'docs', url: 'https://expressjs.com/en/guide/routing/' },
      ]),
    ).toEqual([true, false, true, true]);
  });
});
