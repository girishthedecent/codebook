import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import {
  validateQueryParams,
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { workspaceParamsSchema } from '../workspaces/workspace.validator.js';
import {
  createConversationHandler,
  deleteConversationHandler,
  feedbackHandler,
  getConversationHandler,
  listConversationsHandler,
  updateConversationHandler,
} from './conversation.controller.js';
import {
  conversationMessagesQuerySchema,
  conversationParamsSchema,
  createConversationSchema,
  feedbackSchema,
  listConversationsQuerySchema,
  messageParamsSchema,
  updateConversationSchema,
} from './conversation.validator.js';

// /workspaces/:workspaceId/conversations. Mounted inside the workspace router, which has
// already run requireAuth.
export const workspaceConversationsRouter = express.Router({ mergeParams: true });

workspaceConversationsRouter.use(validateRequestParams(workspaceParamsSchema));

workspaceConversationsRouter.get(
  '/',
  validateQueryParams(listConversationsQuerySchema),
  listConversationsHandler,
);
workspaceConversationsRouter.post(
  '/',
  validateRequestBody(createConversationSchema),
  createConversationHandler,
);

// /conversations/:conversationId
export const conversationRouter = express.Router();

conversationRouter.use(requireAuth);

conversationRouter.get(
  '/:conversationId',
  validateRequestParams(conversationParamsSchema),
  validateQueryParams(conversationMessagesQuerySchema),
  getConversationHandler,
);
conversationRouter.patch(
  '/:conversationId',
  validateRequestParams(conversationParamsSchema),
  validateRequestBody(updateConversationSchema),
  updateConversationHandler,
);
conversationRouter.delete(
  '/:conversationId',
  validateRequestParams(conversationParamsSchema),
  deleteConversationHandler,
);

// /messages/:messageId/feedback
export const messageRouter = express.Router();

messageRouter.use(requireAuth);

messageRouter.post(
  '/:messageId/feedback',
  validateRequestParams(messageParamsSchema),
  validateRequestBody(feedbackSchema),
  feedbackHandler,
);
