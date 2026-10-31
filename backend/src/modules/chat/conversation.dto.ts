import type { z } from 'zod';
import type { Conversation, Message } from '../../generated/prisma/client.js';
import type {
  conversationParamsSchema,
  createConversationSchema,
  feedbackSchema,
  messageParamsSchema,
  updateConversationSchema,
} from './conversation.validator.js';

export type ConversationParams = z.infer<typeof conversationParamsSchema>;
export type MessageParams = z.infer<typeof messageParamsSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;

// Picked field by field, so internal columns (the rolling summary, token counts) stay out of
// responses.
export function toConversationResponse(conversation: Conversation) {
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    title: conversation.title,
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
