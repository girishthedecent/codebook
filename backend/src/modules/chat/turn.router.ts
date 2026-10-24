import express from 'express';
import { requireAuth } from '../../middlewares/auth.middleware.js';
import { limit, perGuestIp } from '../../middlewares/rateLimit.middleware.js';
import {
  validateRequestBody,
  validateRequestParams,
} from '../../middlewares/validator.middleware.js';
import { conversationParamsSchema } from './conversation.validator.js';
import { sendMessageHandler } from './turn.controller.js';
import { sendMessageSchema } from './turn.validator.js';

// POST /conversations/:conversationId/messages: one turn, streamed over SSE.
export const turnRouter = express.Router();

turnRouter.post(
  '/:conversationId/messages',
  requireAuth,
  validateRequestParams(conversationParamsSchema),
  validateRequestBody(sendMessageSchema),
  limit('guestMessages', perGuestIp),
  limit('messagesHourly'),
  limit('messagesDaily'),
  sendMessageHandler,
);
