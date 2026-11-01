import prismaClient from '../../config/db.config.js';
import type { Feedback, Message, Prisma } from '../../generated/prisma/client.js';
import type { Page, PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import type { ListConversationsQuery } from './conversation.dto.js';
import { encodeListCursor, type ConversationListCursor } from './conversation.validator.js';

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

// The first question, which a conversation's preview is made from.
const withFirstQuestion = {
  messages: {
    where: { role: 'USER' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 1,
    select: { content: true },
  },
} satisfies Prisma.ConversationInclude;

export async function createConversation(userId: string, workspaceId: string, title: string) {
  return prismaClient.conversation.create({ data: { userId, workspaceId, title } });
}

/** Rows that come after the cursor in the list order (see listConversations). */
function afterCursor({ pinnedAt, updatedAt, id }: ConversationListCursor) {
  const later: Prisma.ConversationWhereInput = {
    OR: [{ updatedAt: { lt: updatedAt } }, { updatedAt, id: { lt: id } }],
  };
  if (!pinnedAt) return { AND: [{ pinnedAt: null }, later] };
  return {
    OR: [{ pinnedAt: { lt: pinnedAt } }, { AND: [{ pinnedAt }, later] }, { pinnedAt: null }],
  };
}

/**
 * The user's conversations in a workspace with their first questions: the pinned ones first,
 * most recently pinned first, then the rest by last activity.
 */
export async function listConversations(
  userId: string,
  workspaceId: string,
  { cursor, limit }: ListConversationsQuery,
) {
  const rows = await prismaClient.conversation.findMany({
    where: { AND: [{ userId, workspaceId }, cursor ? afterCursor(cursor) : {}] },
    orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'desc' }],
    include: withFirstQuestion,
    take: limit + 1,
  });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeListCursor(last) : null };
}

export async function findConversationForUser(userId: string, conversationId: string) {
  return prismaClient.conversation.findFirst({
    where: { id: conversationId, ...visibleTo(userId) },
    include: { workspace: { select: { userId: true } } },
  });
}

/** The newest messages of a conversation, newest first. */
export async function lastMessages(conversationId: string, take: number) {
  return prismaClient.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });
}

/** Saves the question, and in the same step removes the messages of the attempt it replaces. */
export async function saveQuestion(
  data: Prisma.MessageUncheckedCreateInput,
  replacedIds: string[],
) {
  const [, question] = await prismaClient.$transaction([
    prismaClient.message.deleteMany({
      where: { id: { in: replacedIds }, conversationId: data.conversationId },
    }),
    prismaClient.message.create({ data }),
  ]);
  return question;
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

/** The conversation's first question, for its preview; empty when nothing was asked yet. */
export async function firstQuestion(conversationId: string) {
  const { where, ...query } = withFirstQuestion.messages;
  return prismaClient.message.findMany({ ...query, where: { ...where, conversationId } });
}

/**
 * Renames and pins or unpins. Pinning a pinned one keeps its pin time. Null when the
 * conversation isn't this user's.
 */
export async function updateConversation(
  userId: string,
  conversationId: string,
  { title, pinned }: { title?: string; pinned?: boolean },
) {
  const where = { id: conversationId, ...visibleTo(userId) };
  if (!(await prismaClient.conversation.findFirst({ where, select: { id: true } }))) return null;

  if (pinned !== undefined) await setPinned(conversationId, pinned);
  if (title !== undefined) {
    const [updated] = await prismaClient.conversation.updateManyAndReturn({
      where,
      data: { title },
    });
    return updated ?? null;
  }
  return prismaClient.conversation.findUnique({ where: { id: conversationId } });
}

// Pinning is not activity, so it goes around Prisma, which would bump updatedAt. One statement
// leaves updatedAt alone: the conversation keeps its place among the unpinned ones, and an
// answer saved at the same moment keeps the time it set.
async function setPinned(conversationId: string, pinned: boolean) {
  await (pinned
    ? prismaClient.$executeRaw`
        UPDATE "Conversation" SET "pinnedAt" = COALESCE("pinnedAt", ${new Date()})
        WHERE id = ${conversationId}`
    : prismaClient.$executeRaw`
        UPDATE "Conversation" SET "pinnedAt" = NULL WHERE id = ${conversationId}`);
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

/** A message in one of this user's conversations, with its workspace's owner; or null. */
export async function findMessageForUser(userId: string, messageId: string) {
  return prismaClient.message.findFirst({
    where: { id: messageId, conversation: visibleTo(userId) },
    include: { conversation: { select: { workspace: { select: { userId: true } } } } },
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

/** Only replaces the title `from`, so a rename made meanwhile wins. */
export async function replaceTitle(conversationId: string, from: string, to: string) {
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
