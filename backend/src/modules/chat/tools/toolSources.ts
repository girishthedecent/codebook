import prismaClient from '../../../config/db.config.js';
import type { SourceType } from '../../../generated/prisma/enums.js';
import type { ToolContext } from './tool.types.js';

// The model names sources by id, and an id it was never shown (another workspace, the demo,
// a guess) must look exactly like one that doesn't exist.

export const NO_SOURCE = 'There is no source with that id in this workspace.';

const SOURCE_FIELDS = { id: true, title: true, type: true, workspaceId: true } as const;

export type ToolSourceRow = { id: string; title: string; type: SourceType };

/** The source, only if it belongs to the workspace this conversation is in. */
export async function toolSource(
  ctx: ToolContext,
  sourceId: string,
): Promise<ToolSourceRow | null> {
  const source = await prismaClient.source.findFirst({
    where: { id: sourceId, workspaceId: ctx.workspaceId },
    select: SOURCE_FIELDS,
  });
  return source && { id: source.id, title: source.title, type: source.type };
}

/** The workspace's sources with these ids; unknown and foreign ids are left out. */
export async function toolSources(ctx: ToolContext, sourceIds: string[]): Promise<ToolSourceRow[]> {
  return prismaClient.source.findMany({
    where: { id: { in: sourceIds }, workspaceId: ctx.workspaceId },
    select: { id: true, title: true, type: true },
  });
}

/** The repository the graph tools work on: the one named, or the workspace's only one. */
export async function graphRepo(
  ctx: ToolContext,
  sourceId: string | undefined,
): Promise<{ repo: ToolSourceRow } | { error: string }> {
  if (sourceId) {
    const source = await toolSource(ctx, sourceId);
    if (!source) return { error: NO_SOURCE };
    if (source.type !== 'GITHUB_REPO') {
      return {
        error: `"${source.title}" is not a code repository; the code graph only covers repositories.`,
      };
    }
    return { repo: source };
  }
  const repos = await prismaClient.source.findMany({
    where: { workspaceId: ctx.workspaceId, type: 'GITHUB_REPO' },
    select: { id: true, title: true, type: true },
    orderBy: { createdAt: 'asc' },
  });
  if (repos.length === 0) return { error: 'This workspace has no code repository.' };
  if (repos.length > 1) {
    const list = repos.map((repo) => `- ${repo.id}: ${repo.title}`).join('\n');
    return { error: `This workspace has several repositories; pass sourceId, one of:\n${list}` };
  }
  return { repo: repos[0]! };
}
