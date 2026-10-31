import { randomBytes } from 'node:crypto';
import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';
import logger from '../../config/logger.config.js';
import {
  Prisma,
  type Conversation,
  type Message,
  type Workspace,
} from '../../generated/prisma/client.js';
import { inngest } from '../../config/inngest.config.js';
import { conversationTurnCompleted } from '../../inngest/events.js';
import { isQuotaError } from '../../llm/circuitBreaker.js';
import type { ModelRef } from '../../llm/models.js';
import { AppError, NotFoundError } from '../../utils/errors/app.error.js';
import { assertTokenBudget } from '../../utils/quotas.js';
import { checkCitations, normalizeCitations } from '../citations/citationCheck.js';
import { CitationRegistry } from '../citations/citationRegistry.js';
import type { CheckedCitation, CitationRef } from '../citations/citations.types.js';
import {
  answerCacheKey,
  findCachedAnswer,
  storeCachedAnswer,
  type CachedAnswer,
} from '../demo/answerCache.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';
import {
  runAgent,
  type AgentEvent,
  type AgentProgress,
  type AgentResult,
  type SavedToolCall,
} from './agent.js';
import { DEFAULT_AGENT_PROMPT } from '../../llm/prompts/agentSystem.js';
import { buildAgentContext, type AgentPromptId } from './context.js';
import {
  findConversationForUser,
  lastMessages,
  replaceTitle,
  saveQuestion,
} from './conversation.repository.js';
import { DEFAULT_TITLE, provisionalTitle } from './conversation.service.js';
import { agentTools } from './tools/index.js';

export type TurnEvent =
  | AgentEvent
  | { type: 'title'; title: string }
  | { type: 'citations'; items: unknown[] }
  // `cached`: the answer was kept from an earlier visitor's, no model ran.
  | { type: 'done'; messageId: string; usage: TurnUsage; latencyMs: number; cached: boolean }
  | { type: 'error'; code: string; message: string };

export type TurnUsage = {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: string;
};

export type PreparedTurn = {
  userId: string;
  conversation: Conversation;
  workspace: Workspace;
  isGuest: boolean;
  // The eval user: no daily budget, and no title, summary or memory work after the turn.
  isSystem: boolean;
  questionId: string;
  question: string;
  // The name this turn gave a conversation that still had the default one.
  titleSet: string | null;
};

export type TurnOptions = {
  // The request's toggle; guests never use memory.
  useMemory?: boolean;
  // Eval configs only: what the agent may use, set per run.
  experiment?: {
    // Tool names the agent gets, in the usual order; unknown names are an error.
    tools?: string[];
    // One model pins the run to it (no fallback).
    models?: ModelRef[];
    promptId?: AgentPromptId;
    staticRag?: boolean;
    maxInputTokens?: number;
  };
};

/** What a turn ended with, for callers that collect it instead of streaming it (evals). */
export type TurnOutcome = {
  messageId: string;
  status: 'COMPLETE' | 'ERROR' | 'ABORTED';
  answer: string;
  citations: CheckedCitation[];
  // Every passage the agent was shown, numbered as the answer cites them.
  passages: readonly CitationRef[];
  toolCalls: SavedToolCall[];
  model: ModelRef | null;
  promptId: string;
  steps: number;
  forcedFinal: boolean;
  fallbackUsed: boolean;
  weakRetrieval: boolean;
  usage: TurnUsage;
  latencyMs: number;
  firstTokenMs: number | null;
  error: string | null;
  // What the client was told when the turn failed (UPSTREAM_ERROR, INTERNAL...); null otherwise.
  errorCode: string | null;
};

/**
 * An id in the shape the routes accept (`z.cuid()`), made before the answer exists so the
 * model calls of this turn can be recorded against it.
 */
function newMessageId() {
  return `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}

// A question with no saved answer may still be answering. Each model call gives up within a
// minute, but a turn runs several steps and can fall back between models, so only a question
// well past any real turn is taken as abandoned (the server stopped before it saved a failure).
const ABANDONED_AFTER_MS = 15 * 60_000;

/**
 * The messages a retry of `question` replaces: the last exchange when it ended without an
 * answer (a failed or cut-off reply, or none at all) and asked the same thing. Empty
 * otherwise, and then the retry is an ordinary question. `last` is the conversation's newest
 * messages, newest first.
 */
export function retriedMessages(last: Message[], question: string, now = Date.now()) {
  const same = (message?: Message) =>
    message?.role === 'USER' && message.content.trim() === question.trim();
  const [newest, before] = last;
  if (newest?.role === 'ASSISTANT' && newest.status !== 'COMPLETE' && same(before)) {
    return [newest.id, before!.id];
  }
  if (same(newest) && now - newest!.createdAt.getTime() > ABANDONED_AFTER_MS) return [newest!.id];
  return [];
}

/**
 * Everything that can fail with a plain HTTP error runs before the stream opens: access,
 * the daily token budget, and saving the question. A conversation that still has the default
 * name is named after the question.
 */
export async function prepareTurnService(
  user: { id: string; isGuest?: boolean | null; isSystem?: boolean | null },
  conversationId: string,
  content: string,
  options: {
    // Off: the question is never read by memory extraction.
    useMemory?: boolean;
    // Replace the failed attempt of this question instead of adding another.
    retry?: boolean;
  } = {},
): Promise<PreparedTurn> {
  const { useMemory = true, retry = false } = options;
  const userId = user.id;
  const conversation = await findConversationForUser(userId, conversationId);
  if (!conversation) throw new NotFoundError('Conversation not found');
  const workspace = await assertWorkspaceAccess(userId, conversation.workspaceId, {
    allowDemoRead: true,
  });
  // The eval user runs whole datasets in a day; its spend is bounded by the run itself.
  if (user.isSystem !== true) await assertTokenBudget(userId);
  const replaced = retry ? retriedMessages(await lastMessages(conversationId, 2), content) : [];
  const question = await saveQuestion(
    {
      conversationId,
      role: 'USER',
      content,
      memoryOff: !useMemory || user.isGuest === true,
    },
    replaced,
  );
  await prismaClient.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  // The title model only runs after the first answer; until then the question names it.
  const title =
    user.isSystem !== true && conversation.title === DEFAULT_TITLE
      ? provisionalTitle(content)
      : null;
  const named = title !== null && (await replaceTitle(conversationId, DEFAULT_TITLE, title));
  return {
    userId,
    conversation,
    workspace,
    isGuest: user.isGuest === true,
    isSystem: user.isSystem === true,
    questionId: question.id,
    question: content,
    titleSet: named ? title : null,
  };
}

async function turnUsage(messageId: string): Promise<TurnUsage> {
  const sums = await prismaClient.usageEvent.aggregate({
    where: { messageId },
    _sum: { tokensIn: true, tokensOut: true, tokensCached: true, costUsd: true },
  });
  return {
    tokensIn: sums._sum.tokensIn ?? 0,
    tokensOut: sums._sum.tokensOut ?? 0,
    tokensCached: sums._sum.tokensCached ?? 0,
    costUsd: (sums._sum.costUsd ?? new Prisma.Decimal(0)).toString(),
  };
}

function publicError(error: unknown) {
  if (error instanceof AppError && error.statusCode < 500) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof AppError && error.code === 'UPSTREAM_ERROR') {
    // The last model tried was out of quota too: the free limits reset within a minute or so.
    const message = isQuotaError(error.cause)
      ? 'The models are at their free-tier limit right now. Try again in a minute.'
      : 'The model could not answer right now. Try again.';
    return { code: error.code, message };
  }
  return { code: 'INTERNAL', message: 'Something went wrong' };
}

function experimentTools(names: string[] | undefined) {
  if (!names) return agentTools;
  const unknown = names.filter((name) => !agentTools.some((tool) => tool.name === name));
  if (unknown.length > 0) throw new Error(`Unknown agent tools: ${unknown.join(', ')}`);
  return agentTools.filter((tool) => names.includes(tool.name));
}

/**
 * Runs one answer: the agent streams steps and tokens through `emit`, then the citations
 * are checked and the answer saved with what it cost. A failed or aborted answer is saved
 * too, with the text it had so far. Returns what was saved, for callers without a stream.
 */
export async function runTurnService(
  turn: PreparedTurn,
  emit: (event: TurnEvent) => void,
  signal: AbortSignal,
  options: TurnOptions = {},
): Promise<TurnOutcome> {
  const started = performance.now();
  const messageId = newMessageId();
  const registry = new CitationRegistry();
  const experiment = options.experiment ?? {};
  const useMemory = options.useMemory !== false && !turn.isGuest;
  const tools = experimentTools(experiment.tools);
  let promptId: string = experiment.promptId ?? DEFAULT_AGENT_PROMPT;
  let partial = '';
  let result: AgentResult | undefined;
  const progress: AgentProgress = { toolCalls: [] };

  if (turn.titleSet) emit({ type: 'title', title: turn.titleSet });

  // Demo visitors' first questions: a repeat is answered from the cache, without the model.
  let cacheKey: string | null = null;
  let cached: CachedAnswer | null = null;
  try {
    cacheKey = options.experiment ? null : await answerCacheKey(turn, useMemory);
    cached = cacheKey ? await findCachedAnswer(cacheKey) : null;
  } catch (error) {
    // The cache only saves model calls; without it the agent answers as usual.
    logger.warn('Could not look up the demo answer cache', {
      error,
      workspaceId: turn.workspace.id,
    });
  }
  if (cached) return replayCachedAnswer(turn, cached, messageId, emit, started);

  try {
    const context = await buildAgentContext({
      workspace: turn.workspace,
      conversationId: turn.conversation.id,
      questionId: turn.questionId,
      question: turn.question,
      userId: turn.userId,
      isGuest: turn.isGuest,
      useMemory,
      promptId: experiment.promptId,
      toolNames: tools.map((tool) => tool.name),
    });
    promptId = context.promptId;
    result = await runAgent({
      system: context.system,
      history: context.history,
      question: turn.question,
      tools,
      models: experiment.models,
      maxInputTokens: experiment.maxInputTokens,
      staticRag: experiment.staticRag,
      ctx: {
        userId: turn.userId,
        workspaceId: turn.workspace.id,
        isOwner: turn.workspace.userId === turn.userId,
        isGuest: turn.isGuest,
        messageId,
        registry,
        signal,
      },
      callCtx: { userId: turn.userId, workspaceId: turn.workspace.id, messageId },
      progress,
      onEvent: (event) => {
        if (event.type === 'token') partial += event.text;
        emit(event);
      },
    });
  } catch (error) {
    const aborted = signal.aborted;
    if (!aborted) logger.error('Chat turn failed', { error, conversationId: turn.conversation.id });
    // The text so far may already cite passages: keep what they point at.
    const content = normalizeCitations(partial);
    const report = checkCitations(content, registry, appConfig.chat.supportOverlap);
    const status = aborted ? 'ABORTED' : 'ERROR';
    const shown = aborted ? null : publicError(error);
    const message = shown?.message ?? 'The client disconnected';
    const latencyMs = Math.round(performance.now() - started);
    const usage = await saveAnswer(turn, messageId, promptId, {
      content,
      memoryOff: !useMemory,
      status,
      error: message,
      latencyMs,
      citations: report.citations,
      invalidCitations: report.invalid,
      toolCalls: progress.toolCalls,
      model: progress.model,
    });
    if (shown) emit({ type: 'error', ...shown });
    return {
      messageId,
      status,
      answer: content,
      citations: report.citations,
      passages: registry.all(),
      toolCalls: progress.toolCalls,
      model: progress.model ?? null,
      promptId,
      steps: 0,
      forcedFinal: false,
      fallbackUsed: false,
      weakRetrieval: false,
      usage,
      latencyMs,
      firstTokenMs: null,
      // The real cause, for eval logs: the client only ever sees the public message.
      error: error instanceof Error ? error.message : String(error),
      errorCode: shown?.code ?? null,
    };
  }

  const answer = normalizeCitations(result.answer);
  const report = checkCitations(answer, registry, appConfig.chat.supportOverlap);
  emit({ type: 'citations', items: report.citations });
  const latencyMs = Math.round(performance.now() - started);
  const usage = await saveAnswer(turn, messageId, promptId, {
    content: answer,
    memoryOff: !useMemory,
    status: 'COMPLETE',
    latencyMs,
    citations: report.citations,
    invalidCitations: report.invalid,
    result,
  });
  if (cacheKey) {
    await storeCachedAnswer(cacheKey, turn.workspace.id, {
      content: answer,
      citations: report.citations,
      invalidCitations: report.invalid,
      model: `${result.model.provider}/${result.model.model}`,
      promptId,
      passages: registry.all().map((passage) => passage.text),
    });
  }
  emit({ type: 'done', messageId, usage, latencyMs, cached: false });

  // Eval turns would spend the quota of the models being measured on titles and summaries.
  if (!turn.isSystem) await sendTurnCompleted(turn, messageId);

  return {
    messageId,
    status: 'COMPLETE',
    answer,
    citations: report.citations,
    passages: registry.all(),
    toolCalls: result.toolCalls,
    model: result.model,
    promptId,
    steps: result.steps,
    forcedFinal: result.forcedFinal,
    fallbackUsed: result.fallbackUsed,
    weakRetrieval: result.weakRetrieval,
    usage,
    latencyMs,
    firstTokenMs: result.firstTokenMs,
    error: null,
    errorCode: null,
  };
}

/**
 * Sends a cached answer the way a live one streams (text, citations, done) and saves it as
 * this conversation's answer. No model runs at all, so turn.completed isn't sent and the
 * conversation keeps the name the question gave it.
 */
async function replayCachedAnswer(
  turn: PreparedTurn,
  cached: CachedAnswer,
  messageId: string,
  emit: (event: TurnEvent) => void,
  started: number,
): Promise<TurnOutcome> {
  emit({ type: 'token', text: cached.content });
  emit({ type: 'citations', items: cached.citations });
  const latencyMs = Math.round(performance.now() - started);
  const usage = await saveAnswer(turn, messageId, cached.promptId, {
    content: cached.content,
    memoryOff: true,
    status: 'COMPLETE',
    latencyMs,
    citations: cached.citations,
    modelName: cached.model,
  });
  emit({ type: 'done', messageId, usage, latencyMs, cached: true });
  return {
    messageId,
    status: 'COMPLETE',
    answer: cached.content,
    citations: cached.citations,
    passages: [],
    toolCalls: [],
    model: null,
    promptId: cached.promptId,
    steps: 0,
    forcedFinal: false,
    fallbackUsed: false,
    weakRetrieval: false,
    usage,
    latencyMs,
    firstTokenMs: null,
    error: null,
    errorCode: null,
  };
}

async function sendTurnCompleted(turn: PreparedTurn, messageId: string) {
  try {
    await inngest.send(
      conversationTurnCompleted.create({ conversationId: turn.conversation.id, messageId }),
    );
  } catch (error) {
    // Only the title, the summary and memory wait on this; the answer is saved.
    logger.warn('Could not send turn.completed', { error, messageId });
  }
}

async function saveAnswer(
  turn: PreparedTurn,
  messageId: string,
  promptId: string,
  answer: {
    content: string;
    memoryOff: boolean;
    status: 'COMPLETE' | 'ERROR' | 'ABORTED';
    error?: string;
    latencyMs: number;
    citations?: CheckedCitation[];
    invalidCitations?: number;
    result?: AgentResult;
    // A failed turn's progress, when there is no result.
    toolCalls?: unknown[];
    model?: ModelRef;
    // A cached answer's model, as it was saved.
    modelName?: string | null;
  },
) {
  const usage = await turnUsage(messageId);
  const { result } = answer;
  const model = result?.model ?? answer.model;
  const modelName = model ? `${model.provider}/${model.model}` : (answer.modelName ?? null);
  await prismaClient.message.create({
    data: {
      id: messageId,
      conversationId: turn.conversation.id,
      role: 'ASSISTANT',
      content: answer.content,
      memoryOff: answer.memoryOff,
      status: answer.status,
      error: answer.error,
      citations: (answer.citations ?? []) as Prisma.InputJsonValue,
      toolCalls: (result?.toolCalls ?? answer.toolCalls ?? []) as Prisma.InputJsonValue,
      model: modelName,
      promptVersion: promptId,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      tokensCached: usage.tokensCached,
      costUsd: new Prisma.Decimal(usage.costUsd),
      latencyMs: answer.latencyMs,
      firstTokenMs: result?.firstTokenMs ?? null,
      retrievalMs: result?.toolMs ?? null,
      invalidCitations: answer.invalidCitations ?? 0,
      weakRetrieval: result?.weakRetrieval ?? false,
    },
  });
  return usage;
}
