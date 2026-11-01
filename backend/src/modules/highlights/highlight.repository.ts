import prismaClient from '../../config/db.config.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { paginate, type PaginationQuery } from '../../utils/helpers/pagination.helpers.js';

// Every highlight goes out with its source's title and type, for lists that span sources.
const withSource = {
  source: { select: { title: true, type: true } },
} satisfies Prisma.HighlightInclude;

/** The user's highlights in a workspace, newest first, optionally of one source. */
export async function listHighlights(
  userId: string,
  workspaceId: string,
  sourceId: string | undefined,
  page: PaginationQuery,
) {
  return paginate(
    (query) =>
      prismaClient.highlight.findMany({
        ...query,
        where: { AND: [query.where, { userId, workspaceId }, sourceId ? { sourceId } : {}] },
        include: withSource,
      }),
    page,
  );
}

export async function sourceInWorkspace(workspaceId: string, sourceId: string) {
  return prismaClient.source.findFirst({
    where: { id: sourceId, workspaceId },
    select: { id: true },
  });
}

/** Creates the highlight unless the user already has `limit` in the workspace; null then. */
export async function createHighlight(data: Prisma.HighlightUncheckedCreateInput, limit: number) {
  return prismaClient.$transaction(async (tx) => {
    // Lock the user row so two parallel creates can't both pass the count.
    await tx.$queryRaw`SELECT 1 FROM "user" WHERE id = ${data.userId} FOR UPDATE`;

    const count = await tx.highlight.count({
      where: { userId: data.userId, workspaceId: data.workspaceId },
    });
    if (count >= limit) return null;

    return tx.highlight.create({ data, include: withSource });
  });
}

/** Null when the highlight isn't this user's. */
export async function updateHighlightNote(
  userId: string,
  highlightId: string,
  note: string | null,
) {
  const { count } = await prismaClient.highlight.updateMany({
    where: { id: highlightId, userId },
    data: { note },
  });
  return count > 0
    ? prismaClient.highlight.findUnique({ where: { id: highlightId }, include: withSource })
    : null;
}

/** Returns false when there was nothing of this user's to delete. */
export async function deleteHighlight(userId: string, highlightId: string) {
  const { count } = await prismaClient.highlight.deleteMany({
    where: { id: highlightId, userId },
  });
  return count > 0;
}
