import { randomBytes } from 'node:crypto';
import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';
import logger from '../../config/logger.config.js';
import { Prisma, type Conversation, type Workspace } from '../../generated/prisma/client.js';
import { inngest } from '../../config/inngest.config.js';
import { conversationTurnCompleted } from '../../inngest/events.js';
import type { ModelRef } from '../../llm/models.js';
import { agentSystemPrompt } from '../../llm/prompts/agentSystem.js';
import { AppError, NotFoundError } from '../../utils/errors/app.error.js';
import { assertTokenBudget } from '../../utils/quotas.js';
import { checkCitations, normalizeCitations } from '../citations/citationCheck.js';
import { CitationRegistry } from '../citations/citationRegistry.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';
import { runAgent, type AgentEvent, type AgentProgress, type AgentResult } from './agent.js';
import { buildAgentContext } from './context.js';
import { findConversationForUser } from './conversation.repository.js';
import { agentTools } from './tools/index.js';

export type TurnEvent =
  | AgentEvent
  | { type: 'citations'; items: unknown[] }
  | { type: 'done'; messageId: string; usage: TurnUsage; latencyMs: number }
  | { type: 'error'; code: string; message: string };

type TurnUsage = { tokensIn: number; tokensOut: number; tokensCached: number; costUsd: string };

export type PreparedTurn = {
  userId: string;
  conversation: Conversation;
  workspace: Workspace;
  isGuest: boolean;
  questionId: string;
  question: string;
};

/**
 * An id in the shape the routes accept (`z.cuid()`), made before the answer exists so the
 * model calls of this turn can be recorded against it.
 */
function newMessageId() {
  return `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}

/**
 * Everything that can fail with a plain HTTP error runs before the stream opens: access,
 * the daily token budget, and saving the question.
 */
export async function prepareTurnService(
  user: { id: string; isGuest?: boolean | null },
  conversationId: string,
  content: string,
): Promise<PreparedTurn> {
  const userId = user.id;
  const conversation = await findConversationForUser(userId, conversationId);
  if (!conversation) throw new NotFoundError('Conversation not found');
  const workspace = await assertWorkspaceAccess(userId, conversation.workspaceId, {
    allowDemoRead: true,
  });
  await assertTokenBudget(userId);
  const question = await prismaClient.message.create({
    data: { conversationId, role: 'USER', content },
  });
  await prismaClient.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  return {
    userId,
    conversation,
    workspace,
    isGuest: user.isGuest === true,
    questionId: question.id,
    question: content,
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
    return { code: error.code, message: 'The model could not answer right now. Try again.' };
  }
  return { code: 'INTERNAL', message: 'Something went wrong' };
}

/**
 * Runs one answer: the agent streams steps and tokens through `emit`, then the citations
 * are checked and the answer saved with what it cost. A failed or aborted answer is saved
 * too, with the text it had so far.
 */
export async function runTurnService(
  turn: PreparedTurn,
  emit: (event: TurnEvent) => void,
  signal: AbortSignal,
) {
  const started = performance.now();
  const messageId = newMessageId();
  const registry = new CitationRegistry();
  let partial = '';
  let result: AgentResult | undefined;
  const progress: AgentProgress = { toolCalls: [] };

  try {
    const { system, history } = await buildAgentContext(
      turn.workspace,
      turn.conversation.id,
      turn.questionId,
    );
    result = await runAgent({
      system,
      history,
      question: turn.question,
      tools: agentTools,
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
    await saveAnswer(turn, messageId, {
      content,
      status: aborted ? 'ABORTED' : 'ERROR',
      error: aborted ? 'The client disconnected' : publicError(error).message,
      latencyMs: Math.round(performance.now() - started),
      citations: report.citations,
      invalidCitations: report.invalid,
      toolCalls: progress.toolCalls,
      model: progress.model,
    });
    if (!aborted) emit({ type: 'error', ...publicError(error) });
    return;
  }

  const answer = normalizeCitations(result.answer);
  const report = checkCitations(answer, registry, appConfig.chat.supportOverlap);
  emit({ type: 'citations', items: report.citations });
  const latencyMs = Math.round(performance.now() - started);
  const usage = await saveAnswer(turn, messageId, {
    content: answer,
    status: 'COMPLETE',
    latencyMs,
    citations: report.citations,
    invalidCitations: report.invalid,
    result,
  });
  emit({ type: 'done', messageId, usage, latencyMs });

  try {
    await inngest.send(
      conversationTurnCompleted.create({ conversationId: turn.conversation.id, messageId }),
    );
  } catch (error) {
    // Only the title and the summary wait on this; the answer is saved.
    logger.warn('Could not send turn.completed', { error, messageId });
  }
}

async function saveAnswer(
  turn: PreparedTurn,
  messageId: string,
  answer: {
    content: string;
    status: 'COMPLETE' | 'ERROR' | 'ABORTED';
    error?: string;
    latencyMs: number;
    citations?: unknown[];
    invalidCitations?: number;
    result?: AgentResult;
    // A failed turn's progress, when there is no result.
    toolCalls?: unknown[];
    model?: ModelRef;
  },
) {
  const usage = await turnUsage(messageId);
  const { result } = answer;
  const model = result?.model ?? answer.model;
  await prismaClient.message.create({
    data: {
      id: messageId,
      conversationId: turn.conversation.id,
      role: 'ASSISTANT',
      content: answer.content,
      status: answer.status,
      error: answer.error,
      citations: (answer.citations ?? []) as Prisma.InputJsonValue,
      toolCalls: (result?.toolCalls ?? answer.toolCalls ?? []) as Prisma.InputJsonValue,
      model: model ? `${model.provider}/${model.model}` : null,
      promptVersion: agentSystemPrompt.id,
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
