import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/helpers/pagination.helpers.js';
import { text } from '../sources/source.validator.js';

const title = text(200).trim().min(1);

export const conversationParamsSchema = z.object({ conversationId: z.cuid() });

export const messageParamsSchema = z.object({ messageId: z.cuid() });

export const createConversationSchema = z.object({ title: title.optional() });

export const updateConversationSchema = z.object({ title });

export const listConversationsQuerySchema = paginationQuerySchema;

export const conversationMessagesQuerySchema = paginationQuerySchema;

export const feedbackSchema = z.object({
  value: z.enum(['UP', 'DOWN']),
  note: text(1_000).trim().optional(),
});
