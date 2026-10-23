import prismaClient from '../../config/db.config.js';
import { Prisma, type Source, type SourceStatus } from '../../generated/prisma/client.js';
import { paginate, type PaginationQuery } from '../../utils/helpers/pagination.helpers.js';

type NewSource = Omit<Prisma.SourceUncheckedCreateInput, 'workspaceId'>;

export type CreateSourceResult =
  { ok: true; source: Source } | { ok: false; reason: 'limit' | 'duplicate' | 'no-workspace' };

/** Creates the source unless the workspace is full or already has the same one. */
export async function createSource(
  workspaceId: string,
  data: NewSource,
  limit: number,
): Promise<CreateSourceResult> {
  try {
    return await prismaClient.$transaction(async (tx) => {
      // Lock the workspace row so two parallel creates can't both pass the count. No row means
      // the workspace was deleted after the access check.
      const locked = await tx.$queryRaw<unknown[]>`
        SELECT 1 FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE
      `;
      if (locked.length === 0) return { ok: false, reason: 'no-workspace' } as const;

      const count = await tx.source.count({ where: { workspaceId } });
      if (count >= limit) return { ok: false, reason: 'limit' } as const;

      return { ok: true, source: await tx.source.create({ data: { ...data, workspaceId } }) };
    });
  } catch (error) {
    // (workspaceId, dedupeKey) is unique, so a duplicate can't slip in even under a race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'duplicate' };
    }
    throw error;
  }
}

export async function listSources(workspaceId: string, page: PaginationQuery) {
  return paginate(
    (query) =>
      prismaClient.source.findMany({ ...query, where: { AND: [query.where, { workspaceId }] } }),
    page,
  );
}

/**
 * The source with its workspace's owner, or null when it doesn't exist or this user can't
 * see it. `includeDemo` also finds sources in the public demo workspace.
 */
export async function findSourceForUser(
  userId: string,
  sourceId: string,
  { includeDemo = false } = {},
) {
  return prismaClient.source.findFirst({
    where: {
      id: sourceId,
      workspace: { OR: includeDemo ? [{ userId }, { isDemo: true }] : [{ userId }] },
    },
    include: { workspace: { select: { userId: true } } },
  });
}

export async function findSource(sourceId: string) {
  return prismaClient.source.findUnique({ where: { id: sourceId } });
}

/** The updated source, or null when it was deleted in the meantime. */
export async function updateSourceIfExists(
  sourceId: string,
  data: Prisma.SourceUpdateManyMutationInput,
) {
  const [source] = await prismaClient.source.updateManyAndReturn({ where: { id: sourceId }, data });
  return source ?? null;
}

/** Deletes the source if it's still there; false when it was already gone. */
export async function deleteSource(sourceId: string) {
  const { count } = await prismaClient.source.deleteMany({ where: { id: sourceId } });
  return count > 0;
}

/**
 * Puts the source back in the queue unless an ingest is already queued or running.
 * Conditional on the status in one statement, so two resyncs can't both start one.
 */
export async function requeueSource(sourceId: string) {
  const { count } = await prismaClient.source.updateMany({
    where: { id: sourceId, status: { in: ['READY', 'FAILED'] } },
    data: { status: 'PENDING', stage: 'QUEUED', progress: 0, error: null },
  });
  return count > 0;
}

export async function countSourcesByStatus(workspaceId: string) {
  const groups = await prismaClient.source.groupBy({
    by: ['status'],
    where: { workspaceId },
    _count: { _all: true },
  });
  const counts: Record<SourceStatus, number> = { PENDING: 0, PROCESSING: 0, READY: 0, FAILED: 0 };
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
}

/**
 * Updates ingestion state. False when the source is gone (deleted while queued or
 * running), so the job can stop instead of failing.
 */
export async function setIngestState(sourceId: string, data: Prisma.SourceUpdateManyMutationInput) {
  const { count } = await prismaClient.source.updateMany({ where: { id: sourceId }, data });
  return count > 0;
}
