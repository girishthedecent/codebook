import prismaClient from '../../config/db.config.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { paginate, type PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import type { UpdateWorkspaceInput, WorkspaceSettings } from './workspace.dto.js';

type NewWorkspace = Omit<Prisma.WorkspaceUncheckedCreateInput, 'userId'>;

/** Creates the workspace unless the user already has `limit` of them; returns null then. */
export async function createWorkspace(userId: string, data: NewWorkspace, limit: number) {
  return prismaClient.$transaction(async (tx) => {
    // Lock the owner row so two parallel creates can't both pass the count.
    await tx.$queryRaw`SELECT 1 FROM "user" WHERE id = ${userId} FOR UPDATE`;

    const count = await tx.workspace.count({ where: { userId } });
    if (count >= limit) return null;

    return tx.workspace.create({ data: { ...data, userId } });
  });
}

export async function listWorkspaces(userId: string, page: PaginationQuery) {
  return paginate(
    (query) =>
      prismaClient.workspace.findMany({ ...query, where: { AND: [query.where, { userId }] } }),
    page,
  );
}

/** Null when the workspace doesn't exist or isn't visible to this user. */
export async function findWorkspaceForUser(
  userId: string,
  workspaceId: string,
  { includeDemo = false } = {},
) {
  return prismaClient.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: includeDemo ? [{ userId }, { isDemo: true }] : [{ userId }],
    },
  });
}

/**
 * Updates the workspace and merges `settings` into the stored ones, so a client can change one
 * key without resending the rest. Null when the workspace isn't this user's.
 */
export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  { settings, ...fields }: UpdateWorkspaceInput,
) {
  return prismaClient.$transaction(async (tx) => {
    // Row lock, so two PATCHes changing different settings keys don't drop each other's change.
    const [current] = await tx.$queryRaw<{ settings: WorkspaceSettings }[]>`
      SELECT settings FROM "Workspace"
      WHERE id = ${workspaceId} AND "userId" = ${userId}
      FOR UPDATE
    `;
    if (!current) return null;

    return tx.workspace.update({
      where: { id: workspaceId },
      data: { ...fields, settings: settings && { ...current.settings, ...settings } },
    });
  });
}

/** Returns false when there was nothing of this user's to delete. */
export async function deleteWorkspace(userId: string, workspaceId: string) {
  const { count } = await prismaClient.workspace.deleteMany({ where: { id: workspaceId, userId } });
  return count > 0;
}
