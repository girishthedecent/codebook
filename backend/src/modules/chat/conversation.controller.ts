import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import type { PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import type { WorkspaceParams } from '../workspaces/workspace.dto.js';
import {
  toConversationResponse,
  toMessageResponse,
  type ConversationParams,
  type CreateConversationInput,
  type FeedbackInput,
  type MessageParams,
  type UpdateConversationInput,
} from './conversation.dto.js';
import {
  createConversationService,
  deleteConversationService,
  feedbackService,
  getConversationService,
  listConversationsService,
  updateConversationService,
} from './conversation.service.js';

export async function createConversationHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const conversation = await createConversationService(
    user.id,
    workspaceId,
    req.body as CreateConversationInput,
  );
  res
    .status(201)
    .json(successResponse('Conversation created', toConversationResponse(conversation)));
}

export async function listConversationsHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { workspaceId } = res.locals.params as WorkspaceParams;
  const page = await listConversationsService(
    user.id,
    workspaceId,
    res.locals.query as PaginationQuery,
  );
  res.json(
    successResponse('Conversations', {
      items: page.items.map(toConversationResponse),
      nextCursor: page.nextCursor,
    }),
  );
}

export async function getConversationHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { conversationId } = res.locals.params as ConversationParams;
  const { conversation, messages } = await getConversationService(
    user.id,
    conversationId,
    res.locals.query as PaginationQuery,
  );
  res.json(
    successResponse('Conversation', {
      ...toConversationResponse(conversation),
      messages: { items: messages.items.map(toMessageResponse), nextCursor: messages.nextCursor },
    }),
  );
}

export async function updateConversationHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { conversationId } = res.locals.params as ConversationParams;
  const conversation = await updateConversationService(
    user.id,
    conversationId,
    req.body as UpdateConversationInput,
  );
  res.json(successResponse('Conversation updated', toConversationResponse(conversation)));
}

export async function deleteConversationHandler(_req: Request, res: Response) {
  const user = getAuthUser(res);
  const { conversationId } = res.locals.params as ConversationParams;
  await deleteConversationService(user.id, conversationId);
  res.status(204).end();
}

export async function feedbackHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { messageId } = res.locals.params as MessageParams;
  const message = await feedbackService(user.id, messageId, req.body as FeedbackInput);
  res.json(successResponse('Feedback saved', toMessageResponse(message)));
}
