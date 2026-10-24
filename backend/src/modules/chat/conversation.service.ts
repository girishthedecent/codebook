import { appConfig } from '../../config/app.config.js';
import type { Message } from '../../generated/prisma/client.js';
import { generate } from '../../llm/client.js';
import { summarizeConversationPrompt } from '../../llm/prompts/summarizeConversation.js';
import { titlePrompt } from '../../llm/prompts/title.js';
import { BadRequestError, NotFoundError } from '../../utils/errors/app.error.js';
import type { PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import { countTokens } from '../../utils/tokens.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';
import type {
  CreateConversationInput,
  FeedbackInput,
  UpdateConversationInput,
} from './conversation.dto.js';
import {
  countConversations,
  createConversation,
  deleteConversation,
  findConversation,
  findConversationForUser,
  findMessageForUser,
  firstExchange,
  listConversations,
  listMessages,
  messagesAfter,
  replaceDefaultTitle,
  saveSummary,
  setFeedback,
  updateConversationTitle,
} from './conversation.repository.js';

// Replaced by a generated title after the first answer, unless the user renamed it first.
export const DEFAULT_TITLE = 'New conversation';

async function conversationFor(userId: string, conversationId: string) {
  const conversation = await findConversationForUser(userId, conversationId);
  if (!conversation) throw new NotFoundError('Conversation not found');
  return conversation;
}

// Conversations are private to the user who starts them, so anyone who may read a workspace
// (its owner, or anyone on the demo) may chat in it.
export async function createConversationService(
  userId: string,
  workspaceId: string,
  input: CreateConversationInput,
) {
  await assertWorkspaceAccess(userId, workspaceId, { allowDemoRead: true });
  return createConversation(userId, workspaceId, input.title ?? DEFAULT_TITLE);
}

export async function listConversationsService(
  userId: string,
  workspaceId: string,
  page: PaginationQuery,
) {
  await assertWorkspaceAccess(userId, workspaceId, { allowDemoRead: true });
  return listConversations(userId, workspaceId, page);
}

export async function getConversationService(
  userId: string,
  conversationId: string,
  page: PaginationQuery,
) {
  const conversation = await conversationFor(userId, conversationId);
  return { conversation, messages: await listMessages(conversation.id, page) };
}

export async function updateConversationService(
  userId: string,
  conversationId: string,
  input: UpdateConversationInput,
) {
  const conversation = await updateConversationTitle(userId, conversationId, input.title);
  if (!conversation) throw new NotFoundError('Conversation not found');
  return conversation;
}

export async function deleteConversationService(userId: string, conversationId: string) {
  if (!(await deleteConversation(userId, conversationId))) {
    throw new NotFoundError('Conversation not found');
  }
}

/** This user's conversations in the workspace, for the workspace view. */
export async function countConversationsService(userId: string, workspaceId: string) {
  return countConversations(userId, workspaceId);
}

export async function feedbackService(userId: string, messageId: string, input: FeedbackInput) {
  const message = await findMessageForUser(userId, messageId);
  if (!message) throw new NotFoundError('Message not found');
  if (message.role !== 'ASSISTANT') {
    throw new BadRequestError('Only answers can be rated');
  }
  return setFeedback(message.id, input.value, input.note ?? null);
}

// A failed or cut-off answer is left out of what the model reads back.
const usable = (message: Message) => message.status === 'COMPLETE';

const tokensOf = (message: Message) => countTokens(message.content);

/**
 * What the model sees of the conversation so far: the rolling summary and the latest
 * messages after it, oldest first, at most `historyMessages` of them and within
 * `historyTokens` (the oldest go first). Every saved message counts, so a caller that saved
 * the new question first gets it as the last item.
 */
export async function conversationHistory(conversationId: string) {
  const conversation = await findConversation(conversationId);
  if (!conversation) return { summary: null, recent: [] as Message[] };

  const { historyMessages, historyTokens } = appConfig.chat;
  const pending = await messagesAfter(conversationId, conversation.summarizedUpToMessageId);
  const recent = pending.filter(usable).slice(-historyMessages);
  let tokens = recent.reduce((sum, message) => sum + tokensOf(message), 0);
  while (recent.length > 0 && tokens > historyTokens) tokens -= tokensOf(recent.shift()!);
  return { summary: conversation.summary, recent };
}

// The model gets a bounded piece of each message: long answers say little more for a title
// or a summary than their beginning does.
const clip = (text: string, chars = 2_000) =>
  text.length > chars ? `${text.slice(0, chars)} …` : text;

/** The model's reply as a title: one line, no quotes or end punctuation, at most 6 words. */
export function cleanTitle(reply: string) {
  const line = reply.trim().split('\n')[0] ?? '';
  const words = line
    .replace(/^["'“‘`*#\s]+|["'”’`*.!?:;\s]+$/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.join(' ').slice(0, 80);
}

/** Names a conversation still called DEFAULT_TITLE after its first answer. */
export async function nameConversation(conversationId: string) {
  const conversation = await findConversation(conversationId);
  if (!conversation || conversation.title !== DEFAULT_TITLE) return false;

  const { question, answer } = await firstExchange(conversationId);
  if (!question || !answer) return false;

  const { text } = await generate({
    task: 'cheap',
    prompt: titlePrompt.render({ question: clip(question.content), answer: clip(answer.content) }),
    ctx: { userId: conversation.userId, workspaceId: conversation.workspaceId },
  });
  const title = cleanTitle(text);
  return title ? replaceDefaultTitle(conversationId, DEFAULT_TITLE, title) : false;
}

const transcript = (messages: Message[]) =>
  messages
    .map(
      (message) =>
        `${message.role === 'USER' ? 'User' : 'Assistant'}: ${clip(message.content, 4_000)}`,
    )
    .join('\n\n');

/**
 * Folds older messages into the rolling summary: the latest `historyMessages` stay out (the
 * model reads them verbatim), and the rest are folded in once they add up to more than
 * `summarizeAfterTokens`, so a short conversation costs no summary calls.
 */
export async function updateSummary(conversationId: string) {
  const conversation = await findConversation(conversationId);
  if (!conversation) return false;

  const { historyMessages, summarizeAfterTokens } = appConfig.chat;
  const pending = (
    await messagesAfter(conversationId, conversation.summarizedUpToMessageId)
  ).filter(usable);
  const older = pending.slice(0, Math.max(0, pending.length - historyMessages));
  const tokens = older.reduce((sum, message) => sum + tokensOf(message), 0);
  if (older.length === 0 || tokens <= summarizeAfterTokens) return false;

  const { text } = await generate({
    task: 'summarize',
    prompt: summarizeConversationPrompt.render({
      summary: conversation.summary ?? '',
      messages: transcript(older),
    }),
    ctx: { userId: conversation.userId, workspaceId: conversation.workspaceId },
  });
  const summary = text.trim();
  if (!summary) return false;
  await saveSummary(conversationId, summary, older.at(-1)!.id);
  return true;
}
