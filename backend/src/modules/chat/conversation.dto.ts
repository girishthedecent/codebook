import type { z } from 'zod';
import type { Conversation, Message } from '../../generated/prisma/client.js';
import type {
  conversationParamsSchema,
  createConversationSchema,
  feedbackSchema,
  listConversationsQuerySchema,
  messageParamsSchema,
  updateConversationSchema,
} from './conversation.validator.js';

export type ConversationParams = z.infer<typeof conversationParamsSchema>;
export type MessageParams = z.infer<typeof messageParamsSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

// A conversation as the repository returns it for responses: with its first question, if it
// has one, for the preview.
export type ConversationWithPreview = Conversation & { messages?: { content: string }[] };

const PREVIEW_CHARS = 120;

/** The first question on one line, cut to PREVIEW_CHARS with an ellipsis; null if none. */
export function previewOf(question: string | undefined) {
  const chars = Array.from((question ?? '').replace(/\s+/g, ' ').trim());
  if (chars.length === 0) return null;
  if (chars.length <= PREVIEW_CHARS) return chars.join('');
  return `${chars
    .slice(0, PREVIEW_CHARS - 1)
    .join('')
    .trimEnd()}…`;
}

// Picked field by field, so internal columns (the rolling summary, token counts) stay out of
// responses.
export function toConversationResponse(conversation: ConversationWithPreview) {
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    title: conversation.title,
    pinnedAt: conversation.pinnedAt,
    preview: previewOf(conversation.messages?.[0]?.content),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

// Answers also carry what the turn cost, for the owner of the workspace they were asked in.
// Visitors of the demo read answers in someone else's workspace and get the same message
// without those fields.
export function toMessageResponse(message: Message, { ownsWorkspace = false } = {}) {
  const response = {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: message.citations,
    toolCalls: message.toolCalls,
    status: message.status,
    error: message.error,
    feedback: message.feedback,
    feedbackNote: message.feedbackNote,
    createdAt: message.createdAt,
  };
  if (!ownsWorkspace || message.role !== 'ASSISTANT') return response;
  return {
    ...response,
    model: message.model,
    latencyMs: message.latencyMs,
    firstTokenMs: message.firstTokenMs,
    tokensIn: message.tokensIn,
    tokensOut: message.tokensOut,
    tokensCached: message.tokensCached,
    costUsd: message.costUsd.toString(),
    weakRetrieval: message.weakRetrieval,
  };
}
