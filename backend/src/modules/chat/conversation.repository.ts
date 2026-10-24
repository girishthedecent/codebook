import prismaClient from '../../config/db.config.js';
import type { Feedback, Message, Prisma } from '../../generated/prisma/client.js';
import type { Page, PaginationQuery } from '../../utils/helpers/pagination.helpers.js';

// A conversation belongs to the user who started it. They see it as long as its workspace is
// theirs or the public demo (guests chat on the demo workspace, each in their own threads).
const visibleTo = (userId: string): Prisma.ConversationWhereInput => ({
  userId,
  workspace: { OR: [{ userId }, { isDemo: true }] },
});

// Same format as the cursor in pagination.helpers, so paginationQuerySchema decodes it: the
// sort key's timestamp and the id that breaks ties.
function cursorFor(at: Date, id: string) {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString('base64url');
}

function toPage<T extends { id: string }>(rows: T[], limit: number, at: (row: T) => Date): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? cursorFor(at(last), last.id) : null };
}

export async function createConversation(userId: string, workspaceId: string, title: string) {
  return prismaClient.conversation.create({ data: { userId, workspaceId, title } });
}

/** The user's conversations in a workspace, most recently active first. */
export async function listConversations(
  userId: string,
  workspaceId: string,
  { cursor, limit }: PaginationQuery,
) {
  const rows = await prismaClient.conversation.findMany({
    where: {
      AND: [
        { userId, workspaceId },
        cursor
          ? {
              OR: [
                { updatedAt: { lt: cursor.createdAt } },
                { updatedAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  return toPage(rows, limit, (row) => row.updatedAt);
}

export async function findConversationForUser(userId: string, conversationId: string) {
  return prismaClient.conversation.findFirst({
    where: { id: conversationId, ...visibleTo(userId) },
  });
}

/** A conversation's messages in the order they were written. */
export async function listMessages(conversationId: string, { cursor, limit }: PaginationQuery) {
  const rows = await prismaClient.message.findMany({
    where: {
      AND: [
        { conversationId },
        cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  return toPage(rows, limit, (row) => row.createdAt);
}

/** Null when the conversation isn't this user's. */
export async function updateConversationTitle(
  userId: string,
  conversationId: string,
  title: string,
) {
  const { count } = await prismaClient.conversation.updateMany({
    where: { id: conversationId, ...visibleTo(userId) },
    data: { title },
  });
  return count > 0 ? prismaClient.conversation.findUnique({ where: { id: conversationId } }) : null;
}

/** Returns false when there was nothing of this user's to delete. */
export async function deleteConversation(userId: string, conversationId: string) {
  const { count } = await prismaClient.conversation.deleteMany({
    where: { id: conversationId, ...visibleTo(userId) },
  });
  return count > 0;
}

export async function countConversations(userId: string, workspaceId: string) {
  return prismaClient.conversation.count({ where: { userId, workspaceId } });
}

/** A message in one of this user's conversations, or null. */
export async function findMessageForUser(userId: string, messageId: string) {
  return prismaClient.message.findFirst({
    where: { id: messageId, conversation: visibleTo(userId) },
  });
}

export async function setFeedback(messageId: string, value: Feedback, note: string | null) {
  return prismaClient.message.update({
    where: { id: messageId },
    data: { feedback: value, feedbackNote: note },
  });
}

// The rest serves the after-turn function, which works on a conversation it was given, so
// there is no user to scope by.

export async function findConversation(conversationId: string) {
  return prismaClient.conversation.findUnique({ where: { id: conversationId } });
}

/** Messages after `afterId` (all of them when null), oldest first. */
export async function messagesAfter(conversationId: string, afterId: string | null) {
  const boundary = afterId
    ? await prismaClient.message.findUnique({
        where: { id: afterId },
        select: { createdAt: true, id: true },
      })
    : null;
  return prismaClient.message.findMany({
    where: {
      AND: [
        { conversationId },
        boundary
          ? {
              OR: [
                { createdAt: { gt: boundary.createdAt } },
                { createdAt: boundary.createdAt, id: { gt: boundary.id } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** The first message of each role, for naming the conversation. */
export async function firstExchange(conversationId: string) {
  const [question, answer] = await Promise.all(
    (['USER', 'ASSISTANT'] as const).map((role) =>
      prismaClient.message.findFirst({
        where: { conversationId, role, status: 'COMPLETE' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ),
  );
  return { question, answer };
}

/** Only replaces a title nobody has set yet, so a rename made meanwhile wins. */
export async function replaceDefaultTitle(conversationId: string, from: string, to: string) {
  const { count } = await prismaClient.conversation.updateMany({
    where: { id: conversationId, title: from },
    data: { title: to },
  });
  return count > 0;
}

export async function saveSummary(conversationId: string, summary: string, upTo: Message['id']) {
  await prismaClient.conversation.update({
    where: { id: conversationId },
    data: { summary, summarizedUpToMessageId: upTo },
  });
}
