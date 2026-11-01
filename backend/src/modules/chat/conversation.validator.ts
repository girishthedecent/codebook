import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/helpers/pagination.helpers.js';
import { text } from '../sources/source.validator.js';

const title = text(200).trim().min(1);

export const conversationParamsSchema = z.object({ conversationId: z.cuid() });

export const messageParamsSchema = z.object({ messageId: z.cuid() });

export const createConversationSchema = z.object({ title: title.optional() });

export const updateConversationSchema = z
  .object({ title: title.optional(), pinned: z.boolean().optional() })
  .refine((body) => body.title !== undefined || body.pinned !== undefined, {
    message: 'Nothing to update',
  });

// The list is ordered by pin time (unpinned last), then last activity, then id, so its cursor
// carries all three. Opaque to clients, like every cursor.
const listCursorSchema = z
  .string()
  .max(300)
  .transform((value, ctx) => {
    const cursor = decodeListCursor(value);
    if (!cursor) {
      ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
      return z.NEVER;
    }
    return cursor;
  });

const listCursorValueSchema = z.tuple([
  z.iso.datetime().nullable(),
  z.iso.datetime(),
  z.string().min(1),
]);

export type ConversationListCursor = { pinnedAt: Date | null; updatedAt: Date; id: string };

export function encodeListCursor({ pinnedAt, updatedAt, id }: ConversationListCursor) {
  const json = JSON.stringify([pinnedAt?.toISOString() ?? null, updatedAt.toISOString(), id]);
  return Buffer.from(json).toString('base64url');
}

function decodeListCursor(cursor: string): ConversationListCursor | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const result = listCursorValueSchema.safeParse(value);
  if (!result.success) return null;
  const [pinnedAt, updatedAt, id] = result.data;
  return { pinnedAt: pinnedAt ? new Date(pinnedAt) : null, updatedAt: new Date(updatedAt), id };
}

export const listConversationsQuerySchema = paginationQuerySchema.extend({
  cursor: listCursorSchema.optional(),
});

export const conversationMessagesQuerySchema = paginationQuerySchema;

export const feedbackSchema = z.object({
  value: z.enum(['UP', 'DOWN']),
  note: text(1_000).trim().optional(),
});
