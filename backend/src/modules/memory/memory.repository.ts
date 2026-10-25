import prismaClient from '../../config/db.config.js';
import type { MemoryKind } from '../../generated/prisma/client.js';

// Memories belong to one user: every query here is scoped by userId. Vectors are written and
// searched with raw SQL (Prisma can't map vector columns).

export type ScoredMemory = {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  score: number;
};

// A user's memories are few (profile lines are capped, facts grow slowly), so lists aren't
// paged; this only bounds a response.
const LIST_LIMIT = 500;

const literal = (vector: number[]) => `[${vector.join(',')}]`;

export function listMemories(
  userId: string,
  { kind, includeDeleted }: { kind?: MemoryKind; includeDeleted: boolean },
) {
  return prismaClient.memory.findMany({
    where: { userId, ...(kind ? { kind } : {}), ...(includeDeleted ? {} : { deletedAt: null }) },
    orderBy: [{ kind: 'asc' }, { importance: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: LIST_LIMIT,
  });
}

/** One memory of the user's, deleted or not. */
export function findMemory(userId: string, id: string) {
  return prismaClient.memory.findFirst({ where: { id, userId } });
}

export function findLiveMemories(userId: string, ids: string[]) {
  return prismaClient.memory.findMany({ where: { id: { in: ids }, userId, deletedAt: null } });
}

export function countLive(userId: string, kind: MemoryKind) {
  return prismaClient.memory.count({ where: { userId, kind, deletedAt: null } });
}

export async function hasLiveFacts(userId: string) {
  const fact = await prismaClient.memory.findFirst({
    where: { userId, kind: 'FACT', deletedAt: null },
    select: { id: true },
  });
  return fact !== null;
}

/** The profile line that gives way to a new one: least important, then least recently used. */
export function leastImportantProfile(userId: string) {
  return prismaClient.memory.findFirst({
    where: { userId, kind: 'PROFILE', deletedAt: null },
    orderBy: [
      { importance: 'asc' },
      { lastUsedAt: { sort: 'asc', nulls: 'first' } },
      { createdAt: 'asc' },
    ],
  });
}

export function profileMemories(userId: string) {
  return prismaClient.memory.findMany({
    where: { userId, kind: 'PROFILE', deletedAt: null },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
  });
}

/** Creates a memory, soft-deleting `evictId` (a profile line it replaces) in the same transaction. */
export async function createMemory(
  userId: string,
  data: { kind: MemoryKind; content: string; importance: number; sourceMessageId?: string },
  embedding: number[],
  evictId?: string,
) {
  return prismaClient.$transaction(async (tx) => {
    if (evictId) {
      await tx.memory.updateMany({
        where: { id: evictId, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    const memory = await tx.memory.create({ data: { userId, ...data } });
    await tx.$executeRaw`
      UPDATE "Memory" SET embedding = ${literal(embedding)}::vector WHERE id = ${memory.id}
    `;
    return memory;
  });
}

/** Updates a live memory; a new embedding goes with new content. Null when it is gone. */
export async function updateMemory(
  userId: string,
  id: string,
  data: { content?: string; importance?: number; sourceMessageId?: string },
  embedding?: number[],
) {
  return prismaClient.$transaction(async (tx) => {
    const { count } = await tx.memory.updateMany({
      where: { id, userId, deletedAt: null },
      data,
    });
    if (count === 0) return null;
    if (embedding) {
      await tx.$executeRaw`
        UPDATE "Memory" SET embedding = ${literal(embedding)}::vector WHERE id = ${id}
      `;
    }
    return tx.memory.findUniqueOrThrow({ where: { id } });
  });
}

export async function softDeleteMemory(userId: string, id: string) {
  const { count } = await prismaClient.memory.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count > 0;
}

export async function restoreMemory(userId: string, id: string) {
  const { count } = await prismaClient.memory.updateMany({
    where: { id, userId, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  return count > 0;
}

export async function softDeleteAll(userId: string) {
  const { count } = await prismaClient.memory.updateMany({
    where: { userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count;
}

export async function purgeAll(userId: string) {
  const { count } = await prismaClient.memory.deleteMany({ where: { userId } });
  return count;
}

/**
 * The user's live memories closest to `vector`, best first. An exact scan over one user's
 * rows: there is no vector index on Memory (see the migration).
 */
export function similarMemories(
  userId: string,
  vector: number[],
  limit: number,
  kind?: MemoryKind,
) {
  return prismaClient.$queryRaw<ScoredMemory[]>`
    SELECT id, kind, content, importance, (1 - (embedding <=> ${literal(vector)}::vector))::float8 AS score
    FROM "Memory"
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND embedding IS NOT NULL
      AND (${kind ?? null}::text IS NULL OR kind::text = ${kind ?? null}::text)
    ORDER BY embedding <=> ${literal(vector)}::vector, id
    LIMIT ${limit}
  `;
}

export async function touchMemories(ids: string[]) {
  if (ids.length === 0) return;
  await prismaClient.memory.updateMany({
    where: { id: { in: ids } },
    data: { lastUsedAt: new Date() },
  });
}

/** The answer a turn ended with, and who asked. */
export function findTurnAnswer(conversationId: string, messageId: string) {
  return prismaClient.message.findFirst({
    where: { id: messageId, conversationId, role: 'ASSISTANT' },
    include: {
      conversation: {
        select: {
          userId: true,
          workspaceId: true,
          memoryUpToMessageId: true,
          user: { select: { isGuest: true, isSystem: true } },
        },
      },
    },
  });
}

type MessageMark = { id: string; createdAt: Date };

const atOrBefore = (mark: MessageMark) => ({
  OR: [{ createdAt: { lt: mark.createdAt } }, { createdAt: mark.createdAt, id: { lte: mark.id } }],
});

function findMark(id: string | null) {
  return id
    ? prismaClient.message.findUnique({ where: { id }, select: { id: true, createdAt: true } })
    : Promise.resolve(null);
}

/**
 * What extraction may learn from: the conversation's messages after its watermark, up to
 * and including `upTo`, leaving out messages of turns that had memory off (whatever became
 * of the answer). The last `take`, oldest first.
 */
export async function messagesForMemory(
  conversationId: string,
  watermarkId: string | null,
  upTo: MessageMark,
  take: number,
) {
  const watermark = await findMark(watermarkId);
  const rows = await prismaClient.message.findMany({
    where: {
      conversationId,
      memoryOff: false,
      AND: [atOrBefore(upTo), ...(watermark ? [{ NOT: atOrBefore(watermark) }] : [])],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });
  return rows.reverse();
}

/** Moves the watermark to `upTo`, never back past a later one. */
export async function advanceMemoryWatermark(conversationId: string, upTo: MessageMark) {
  const conversation = await prismaClient.conversation.findUnique({
    where: { id: conversationId },
    select: { memoryUpToMessageId: true },
  });
  if (!conversation) return;
  const current = await findMark(conversation.memoryUpToMessageId);
  const later =
    current &&
    (current.createdAt > upTo.createdAt ||
      (current.createdAt.getTime() === upTo.createdAt.getTime() && current.id >= upTo.id));
  if (later) return;
  await prismaClient.conversation.update({
    where: { id: conversationId },
    data: { memoryUpToMessageId: upTo.id },
  });
}

/** A live memory already added from this answer with this content (a retried apply). */
export function findAddedFrom(userId: string, sourceMessageId: string, content: string) {
  return prismaClient.memory.findFirst({
    where: {
      userId,
      sourceMessageId,
      deletedAt: null,
      content: { equals: content, mode: 'insensitive' },
    },
    select: { id: true },
  });
}

export async function hasLiveMemories(userId: string) {
  const row = await prismaClient.memory.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  return row !== null;
}
