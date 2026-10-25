import prismaClient from '../src/config/db.config.js';
import { Prisma, type EvalCase, type EvalResult } from '../src/generated/prisma/client.js';
import type { EvalSplit } from '../src/generated/prisma/enums.js';
import { embeddingRoute, textRoutes, type ModelRef } from '../src/llm/models.js';
import { prompts } from '../src/llm/prompts/index.js';
import { longContextAnswerPrompt } from '../src/llm/prompts/longContextAnswer.js';
import { prepareTurnService, runTurnService } from '../src/modules/chat/turn.service.js';
import type { CheckedCitation } from '../src/modules/citations/citations.types.js';
import { addMemory, purgeMemories } from '../src/modules/memory/memory.service.js';
import { createPacer } from '../src/utils/pacer.js';
import {
  answerConfigNames,
  answerConfigSchema,
  answerModel,
  loadAnswerConfig,
  type AnswerConfig,
} from './answerConfig.js';
import {
  ANSWER_SUITE,
  type AnswerScores,
  type AnswerSummary,
  type StoredAnswerContext,
  type StoredTrajectory,
} from './answer.types.js';
import { loadCorpus, type Corpus, type CorpusVariant } from './corpusWorkspace.js';
import { evalCaseSchema, expectedRefSchema } from './dataset.js';
import {
  answerLongContext,
  buildLongContext,
  refsCovered,
  type LongContext,
} from './longContext.js';
import { canonical, casesHash, errorMessage, gitSha, usageCost } from './runUtils.js';
import { answerOutcomeOf, scoreAnswer, summarizeAnswers } from './scorers/answer.js';
import type { EvalSuite, StartedRun } from './suite.types.js';

// Runs one answer config over a dataset's cases through the real chat pipeline (the agent,
// its tools, the citation check), collecting what the stream would have sent. One EvalRun,
// one EvalResult per case, each judged as it is stored.

export const SUITE = ANSWER_SUITE;

type CaseSelection = { split: EvalSplit; limit?: number; tags?: string[] };

export type AnswerRunOptions = CaseSelection & {
  dataset: string;
  config: AnswerConfig;
  resume?: string;
  log?: (line: string) => void;
};

type AnswerRun = {
  runId: string;
  config: AnswerConfig;
  corpus: Corpus;
  sourceKeys: Map<string, string>;
  model: ModelRef;
  // Built on the first long-context case and reused by the rest.
  longContext?: LongContext;
};

type StoredCorpus = { variant: CorpusVariant; corpusVersion: string };

const openRuns = new Map<string, AnswerRun>();

const modelName = (ref: ModelRef) => `${ref.provider}/${ref.model}`;
const judgeName = () => modelName(textRoutes.judge.primary);

function answerCasesHash(cases: EvalCase[]) {
  // Judged against the expected answer, memory cases depend on what is seeded, and `tool:`
  // tags decide which tools a case expects.
  return casesHash(cases, ({ expectedAnswer, memories, tags }) => ({
    expectedAnswer,
    memories,
    tags,
  }));
}

/**
 * Why a run can't be resumed with this config, corpus, cases, judge and code, or null:
 * results measured under different settings can't share one summary.
 */
export function answerResumeConflict(
  run: { datasetId: string; config: unknown; gitSha: string; models: unknown },
  current: {
    datasetId: string;
    config: AnswerConfig;
    corpusVersion: string;
    gitSha: string;
    casesHash: string;
    judge: string;
  },
) {
  const {
    selection: _,
    casesHash: storedCases,
    corpus,
    ...stored
  } = run.config as {
    selection?: unknown;
    casesHash?: string;
    corpus?: { corpusVersion?: string };
  };
  const { judge = null } = (run.models ?? {}) as { judge?: string | null };
  const { corpus: _variant, ...config } = current.config;
  if (run.datasetId !== current.datasetId) return 'it ran on another dataset';
  if (canonical(stored) !== canonical(config)) return 'its config has changed since';
  if (corpus?.corpusVersion !== current.corpusVersion) return 'the corpus has changed since';
  if (storedCases !== current.casesHash) return 'its cases have changed since';
  if (judge !== current.judge)
    return `it was judged by ${judge ?? 'nothing'}, now ${current.judge}`;
  if (run.gitSha !== current.gitSha) {
    return `it ran on code ${run.gitSha}, this is ${current.gitSha}`;
  }
  return null;
}

function remember(runId: string, config: AnswerConfig, corpus: Corpus) {
  const run: AnswerRun = {
    runId,
    config,
    corpus,
    sourceKeys: new Map(corpus.sources.map((source) => [source.sourceId, source.sourceKey])),
    model: answerModel(config),
  };
  openRuns.set(runId, run);
  return run;
}

function selectCases(datasetId: string, config: AnswerConfig, selection: CaseSelection) {
  return prismaClient.evalCase.findMany({
    where: {
      datasetId,
      retired: false,
      split: selection.split,
      ...(config.caseTypes ? { type: { in: config.caseTypes } } : {}),
      AND: [
        selection.tags?.length ? { tags: { hasSome: selection.tags } } : {},
        config.tags ? { tags: { hasSome: config.tags } } : {},
        config.excludeTags.length > 0 ? { NOT: { tags: { hasSome: config.excludeTags } } } : {},
      ],
    },
    orderBy: { externalId: 'asc' },
    ...(selection.limit ? { take: selection.limit } : {}),
  });
}

/** Creates the run (or reopens one to resume) and returns the cases still to run. */
export async function startAnswers(options: AnswerRunOptions): Promise<StartedRun> {
  const { config, log = () => {} } = options;
  const dataset = await prismaClient.evalDataset.findUnique({ where: { name: options.dataset } });
  if (!dataset) throw new Error(`No dataset "${options.dataset}": run pnpm evals:import first`);

  const corpus = await loadCorpus(options.dataset, config.corpus);
  const notReady = corpus.sources.filter((source) => source.status !== 'READY');
  if (notReady.length > 0) {
    const list = notReady.map((source) => `${source.sourceKey} (${source.status})`).join(', ');
    throw new Error(`Corpus sources not ready: ${list}. Run pnpm evals:corpus first`);
  }

  let selection: CaseSelection = { split: options.split, limit: options.limit, tags: options.tags };
  const resumed = options.resume
    ? await prismaClient.evalRun.findUnique({ where: { id: options.resume } })
    : null;
  if (options.resume) {
    if (!resumed || resumed.suite !== SUITE || resumed.name !== config.name) {
      throw new Error(`Run ${options.resume} is not an ${SUITE} run of ${config.name}`);
    }
    selection = (resumed.config as { selection: CaseSelection }).selection;
  }
  const cases = await selectCases(dataset.id, config, selection);
  const selectedHash = answerCasesHash(cases);
  const sha = gitSha();

  let runId: string;
  if (resumed) {
    const conflict = answerResumeConflict(resumed, {
      datasetId: dataset.id,
      config,
      corpusVersion: corpus.corpusVersion,
      gitSha: sha,
      casesHash: selectedHash,
      judge: judgeName(),
    });
    if (conflict) {
      throw new Error(`Can't resume run ${resumed.id}: ${conflict}. Start a new run instead`);
    }
    await prismaClient.evalResult.deleteMany({
      where: { runId: resumed.id, error: { not: null } },
    });
    await prismaClient.evalRun.update({
      where: { id: resumed.id },
      data: { status: 'RUNNING', finishedAt: null },
    });
    runId = resumed.id;
  } else {
    const run = await prismaClient.evalRun.create({
      data: {
        datasetId: dataset.id,
        suite: SUITE,
        name: config.name,
        config: {
          ...config,
          selection,
          casesHash: selectedHash,
          corpus: {
            variant: config.corpus,
            workspaceId: corpus.workspaceId,
            corpusVersion: corpus.corpusVersion,
            sources: corpus.sources,
          },
        } as Prisma.InputJsonValue,
        gitSha: sha,
        promptVersions: prompts.map((prompt) => prompt.id),
        models: {
          answer: modelName(answerModel(config)),
          judge: judgeName(),
          embedding: embeddingRoute.model,
        },
        split: selection.split,
      },
    });
    runId = run.id;
  }
  remember(runId, config, corpus);

  try {
    // Whatever an earlier run seeded (or a crash left behind) must not reach this one.
    await purgeMemories(corpus.userId);
    const stored = await prismaClient.evalResult.findMany({
      where: { runId },
      select: { caseId: true, scores: true },
    });
    // A case whose judge call failed runs again for the judging alone.
    const doneIds = new Set(
      stored.filter((row) => !judgeFailed(row.scores)).map((row) => row.caseId),
    );
    const todo = cases.filter((evalCase) => !doneIds.has(evalCase.id));
    log(`${config.name}: run ${runId}, ${todo.length} of ${cases.length} cases to run`);
    return { runId, caseIds: todo.map((evalCase) => evalCase.id), gapMs: config.gapMs };
  } catch (caught) {
    await failAnswers(runId, errorMessage(caught));
    throw caught;
  }
}

/** The run's config and corpus, read back from the run when this process didn't start it. */
async function openRun(runId: string): Promise<AnswerRun> {
  const known = openRuns.get(runId);
  if (known) return known;
  const run = await prismaClient.evalRun.findUnique({
    where: { id: runId },
    include: { dataset: { select: { name: true } } },
  });
  if (!run || run.suite !== SUITE) throw new Error(`No ${SUITE} run ${runId}`);
  const {
    selection: _selection,
    casesHash: _cases,
    corpus,
    ...stored
  } = run.config as { selection?: unknown; casesHash?: unknown; corpus: StoredCorpus };
  const config = answerConfigSchema.parse({ ...stored, corpus: corpus.variant });
  // A worker that picked up new code halfway would mix two versions in one run.
  const sha = gitSha();
  if (run.gitSha !== sha) throw new Error(`Run ${runId} ran on code ${run.gitSha}, this is ${sha}`);
  const current = await loadCorpus(run.dataset.name, corpus.variant);
  if (current.corpusVersion !== corpus.corpusVersion) {
    throw new Error(`The corpus of run ${runId} has changed since it started`);
  }
  return remember(runId, config, current);
}

type Answered = {
  answer: string;
  citations: CheckedCitation[];
  context: StoredAnswerContext;
  trajectory: StoredTrajectory;
  tokensIn: number;
  tokensOut: number;
  costUsd: Prisma.Decimal;
  latencyMs: number;
  error: string | null;
};

/** One question through the chat pipeline, as a new conversation of the eval user. */
async function answerWithAgent(run: AnswerRun, evalCase: EvalCase): Promise<Answered> {
  const { config, corpus } = run;
  const conversation = await prismaClient.conversation.create({
    data: {
      workspaceId: corpus.workspaceId,
      userId: corpus.userId,
      title: `Eval ${config.name} · ${evalCase.externalId}`,
    },
  });
  const turn = await prepareTurnService(
    { id: corpus.userId, isSystem: true },
    conversation.id,
    evalCase.question,
  );
  const signal = AbortSignal.timeout(config.timeoutMs);
  // The events are what the SSE stream would have sent; the outcome has all of it.
  const outcome = await runTurnService(turn, () => {}, signal, {
    useMemory: config.useMemory,
    experiment: {
      tools: config.tools,
      models: [run.model],
      promptId: config.promptId,
      staticRag: config.mode === 'static',
      maxInputTokens: config.maxInputTokens,
    },
  });

  const failed = outcome.status !== 'COMPLETE';
  return {
    answer: outcome.answer,
    citations: outcome.citations,
    context: {
      passages: outcome.passages.map((passage) => ({
        ...passage,
        sourceKey: (passage.sourceId && run.sourceKeys.get(passage.sourceId)) || null,
      })),
    },
    trajectory: {
      calls: outcome.toolCalls,
      steps: outcome.steps,
      forcedFinal: outcome.forcedFinal,
      staticRag: config.mode === 'static',
      model: outcome.model ? modelName(outcome.model) : null,
      fallbackUsed: outcome.fallbackUsed,
      promptId: outcome.promptId,
      status: outcome.status,
    },
    tokensIn: outcome.usage.tokensIn,
    tokensOut: outcome.usage.tokensOut,
    costUsd: new Prisma.Decimal(outcome.usage.costUsd),
    latencyMs: outcome.latencyMs,
    error: !failed
      ? null
      : signal.aborted
        ? `Timed out after ${config.timeoutMs} ms`
        : (outcome.error ?? outcome.status),
  };
}

/** One question against the corpus text itself: no tools, no passages to cite. */
async function answerFromCorpusText(run: AnswerRun, evalCase: EvalCase): Promise<Answered> {
  const { config, corpus } = run;
  run.longContext ??= await buildLongContext(corpus, config.maxContextTokens);
  const context = run.longContext;
  const refs = expectedRefSchema.array().parse(evalCase.expectedRefs);
  const stored: StoredAnswerContext = {
    passages: [],
    longContext: {
      tokens: context.tokens,
      kept: context.kept,
      refsCovered: refsCovered(context, refs),
    },
  };
  const trajectory: StoredTrajectory = {
    calls: [],
    steps: 1,
    forcedFinal: false,
    staticRag: false,
    model: modelName(run.model),
    fallbackUsed: false,
    promptId: longContextAnswerPrompt.id,
    status: 'COMPLETE',
  };
  const started = performance.now();
  const startedAt = new Date();
  try {
    const { answer, call } = await answerLongContext({
      context,
      question: evalCase.question,
      model: run.model,
      signal: AbortSignal.timeout(config.timeoutMs),
      userId: corpus.userId,
      workspaceId: corpus.workspaceId,
    });
    return {
      answer,
      citations: [],
      context: stored,
      trajectory: { ...trajectory, model: `${call.provider}/${call.model}` },
      tokensIn: call.tokensIn,
      tokensOut: call.tokensOut,
      costUsd: call.costUsd,
      latencyMs: Math.round(performance.now() - started),
      error: null,
    };
  } catch (caught) {
    return {
      answer: '',
      citations: [],
      context: stored,
      trajectory: { ...trajectory, status: 'ERROR' },
      tokensIn: 0,
      tokensOut: 0,
      // A call that timed out or broke mid-answer may still have been billed.
      costUsd: await usageCost(corpus.userId, startedAt, new Date(), { task: 'longContext' }),
      latencyMs: Math.round(performance.now() - started),
      error: errorMessage(caught),
    };
  }
}

/**
 * Answers one case, judges it and stores the result; the run's cost grows by what the
 * answer and the judge spent. Memory configs seed the case's memories first and remove them
 * afterwards, whatever happens.
 */
/**
 * A judge call failed (quota, timeout, bad output): the answer stands, only the judging is
 * missing. Deliberate skips ("judge off", an input over the judge's cap) are final.
 */
export function judgeFailed(scores: unknown) {
  const skipped = (scores as Partial<AnswerScores> | null)?.judge?.skipped;
  return typeof skipped === 'string' && skipped.includes(' failed: ');
}

type Judged = {
  scores: AnswerScores | Record<string, never>;
  error: string | null;
  cost: Prisma.Decimal;
};

/** Judges a stored or fresh answer; the cost is the eval user's judge calls meanwhile. */
async function judgeAnswer(
  run: AnswerRun,
  evalCase: EvalCase,
  answered: Pick<Answered, 'answer' | 'citations' | 'context' | 'trajectory'>,
): Promise<Judged> {
  const { config, corpus } = run;
  const started = new Date();
  let scores: AnswerScores | Record<string, never> = {};
  let error: string | null = null;
  try {
    const scored = await scoreAnswer(
      {
        caseId: evalCase.id,
        type: evalCase.type,
        question: evalCase.question,
        expectedAnswer: evalCase.expectedAnswer,
        refs: expectedRefSchema.array().parse(evalCase.expectedRefs),
        answer: answered.answer,
        citations: answered.citations,
        passages: answered.context.passages,
        grounded: config.mode !== 'longContext',
      },
      answered.trajectory,
      {
        judge: config.judge,
        tags: evalCase.tags,
        ctx: { userId: corpus.userId, workspaceId: corpus.workspaceId },
      },
    );
    const covered = answered.context.longContext?.refsCovered;
    scores = { ...scored, covered: covered ? covered.every(Boolean) : null };
  } catch (caught) {
    error = `judge: ${errorMessage(caught)}`;
  }
  const cost = await usageCost(corpus.userId, started, new Date(), { task: 'judge' });
  return { scores, error, cost };
}

/** Judges a stored answer again after a judge call failed; the answer isn't asked again. */
async function rejudge(run: AnswerRun, evalCase: EvalCase, stored: EvalResult) {
  const { scores, error, cost } = await judgeAnswer(run, evalCase, {
    answer: stored.answer ?? '',
    citations: (stored.citations ?? []) as unknown as CheckedCitation[],
    context: stored.retrieved as unknown as StoredAnswerContext,
    trajectory: stored.toolTrajectory as unknown as StoredTrajectory,
  });
  await prismaClient.$transaction([
    // A judge that throws (it only does when aborted) leaves the earlier scores in place.
    ...(error
      ? []
      : [
          prismaClient.evalResult.update({
            where: { id: stored.id },
            data: { scores: scores as unknown as Prisma.InputJsonValue },
          }),
        ]),
    prismaClient.evalRun.update({
      where: { id: run.runId },
      data: { costUsd: { increment: cost } },
    }),
  ]);
  return { line: `${evalCase.externalId} judged again: ${caseLine(scores, error)}` };
}

export async function runAnswerCase(runId: string, caseId: string) {
  const run = await openRun(runId);
  const { config, corpus } = run;
  const evalCase = await prismaClient.evalCase.findUniqueOrThrow({ where: { id: caseId } });
  const stored = await prismaClient.evalResult.findUnique({
    where: { runId_caseId: { runId, caseId } },
  });
  if (stored && stored.error === null) {
    if (judgeFailed(stored.scores)) return rejudge(run, evalCase, stored);
    return { line: `${evalCase.externalId} already done` };
  }
  if (stored) await prismaClient.evalResult.delete({ where: { id: stored.id } });

  const caseStarted = new Date();
  let answered: Answered;
  try {
    if (config.useMemory) await seedMemories(corpus.userId, evalCase);
    answered =
      config.mode === 'longContext'
        ? await answerFromCorpusText(run, evalCase)
        : await answerWithAgent(run, evalCase);
  } finally {
    if (config.useMemory) await purgeMemories(corpus.userId);
  }
  // Embeddings no turn message carries: seeding the memories and recalling them.
  const memoryCost = await usageCost(corpus.userId, caseStarted, new Date(), {
    type: 'EMBEDDING',
    outsideMessages: true,
  });
  answered.costUsd = answered.costUsd.add(memoryCost);

  const judged: Judged = answered.error
    ? { scores: {}, error: answered.error, cost: new Prisma.Decimal(0) }
    : await judgeAnswer(run, evalCase, answered);
  const { scores, error } = judged;

  await prismaClient.$transaction([
    prismaClient.evalResult.create({
      data: {
        runId,
        caseId: evalCase.id,
        retrieved: answered.context as unknown as Prisma.InputJsonValue,
        answer: answered.answer,
        citations: answered.citations as unknown as Prisma.InputJsonValue,
        toolTrajectory: answered.trajectory as unknown as Prisma.InputJsonValue,
        scores: scores as unknown as Prisma.InputJsonValue,
        latencyMs: answered.latencyMs,
        tokensIn: answered.tokensIn,
        tokensOut: answered.tokensOut,
        costUsd: answered.costUsd,
        error,
      },
    }),
    prismaClient.evalRun.update({
      where: { id: runId },
      data: { costUsd: { increment: answered.costUsd.add(judged.cost) } },
    }),
  ]);

  return { line: `${evalCase.externalId} ${caseLine(scores, error)} (${answered.latencyMs} ms)` };
}

function caseLine(scores: Partial<AnswerScores>, error: string | null) {
  if (error) return `error: ${error}`;
  const value = (n: number | null | undefined) =>
    n === null || n === undefined ? '–' : n.toFixed(2);
  return `correct ${value(scores.correctness)}, faithful ${value(scores.faithfulness)}, tools ${scores.trajectory?.toolCalls ?? 0}`;
}

async function seedMemories(userId: string, evalCase: EvalCase) {
  await purgeMemories(userId);
  const memories = evalCaseSchema.shape.memories.parse(evalCase.memories);
  for (const memory of memories) await addMemory(userId, memory);
}

export async function answerRunSummary(runId: string): Promise<AnswerSummary> {
  const run = await prismaClient.evalRun.findUniqueOrThrow({ where: { id: runId } });
  const results = await prismaClient.evalResult.findMany({
    where: { runId },
    include: { case: { select: { type: true, tags: true, reviewed: true } } },
  });
  const { answer = null } = run.models as { answer?: string };
  return summarizeAnswers(
    results.map((result) => answerOutcomeOf(result, result.case)),
    { answerModel: answer },
  );
}

export async function finishAnswers(runId: string) {
  const summary = await answerRunSummary(runId);
  await prismaClient.evalRun.update({
    where: { id: runId },
    data: {
      status: 'DONE',
      finishedAt: new Date(),
      summary: summary as unknown as Prisma.InputJsonValue,
    },
  });
  openRuns.delete(runId);
  return summary;
}

export async function failAnswers(runId: string, message: string) {
  openRuns.delete(runId);
  await prismaClient.evalRun.update({
    where: { id: runId },
    data: { status: 'FAILED', finishedAt: new Date(), notes: message },
  });
}

/** Runs a config over the selected cases in this process, one at a time, spaced by gapMs. */
export async function runAnswers(options: AnswerRunOptions) {
  const { log = () => {} } = options;
  const { runId, caseIds, gapMs } = await startAnswers(options);
  try {
    const pace = gapMs > 0 ? createPacer(gapMs) : null;
    for (const [i, caseId] of caseIds.entries()) {
      await pace?.();
      const { line } = await runAnswerCase(runId, caseId);
      log(`  ${i + 1}/${caseIds.length} ${line}`);
    }
    return { runId, summary: await finishAnswers(runId) };
  } catch (caught) {
    await failAnswers(runId, errorMessage(caught));
    throw caught;
  }
}

export const answerSuite: EvalSuite = {
  suite: SUITE,
  configNames: () => answerConfigNames(),
  async start(options) {
    const config = await loadAnswerConfig(options.config);
    return startAnswers({ ...options, config });
  },
  runCase: runAnswerCase,
  finish: async (runId) => {
    await finishAnswers(runId);
  },
  fail: failAnswers,
};
