import prismaClient from '../../config/db.config.js';
import type { Prisma, StudyType } from '../../generated/prisma/client.js';
import { paginate, type PaginationQuery } from '../../utils/helpers/pagination.helpers.js';

export async function createArtifact(data: Prisma.StudyArtifactUncheckedCreateInput) {
  return prismaClient.studyArtifact.create({ data });
}

export async function listArtifacts(
  workspaceId: string,
  type: StudyType | undefined,
  page: PaginationQuery,
) {
  return paginate(
    (query) =>
      prismaClient.studyArtifact.findMany({
        ...query,
        where: { AND: [query.where, { workspaceId }, type ? { type } : {}] },
      }),
    page,
  );
}

/**
 * The artifact with its workspace's owner, or null when it doesn't exist or this user
 * can't see it. `includeDemo` also finds artifacts in the public demo workspace.
 */
export async function findArtifactForUser(
  userId: string,
  artifactId: string,
  { includeDemo = false } = {},
) {
  return prismaClient.studyArtifact.findFirst({
    where: {
      id: artifactId,
      workspace: { OR: includeDemo ? [{ userId }, { isDemo: true }] : [{ userId }] },
    },
    include: { workspace: { select: { userId: true } } },
  });
}

export async function findArtifact(artifactId: string) {
  return prismaClient.studyArtifact.findUnique({ where: { id: artifactId } });
}

/** The updated artifact, or null when it was deleted in the meantime. */
export async function updateArtifactIfExists(
  artifactId: string,
  data: Prisma.StudyArtifactUpdateManyMutationInput,
) {
  const [artifact] = await prismaClient.studyArtifact.updateManyAndReturn({
    where: { id: artifactId },
    data,
  });
  return artifact ?? null;
}

/**
 * Puts the artifact back to PENDING unless a generation is under way (one that hasn't
 * moved since `staleBefore` doesn't count). Null when nothing was changed.
 */
export async function requeueArtifact(artifactId: string, staleBefore: Date) {
  const [artifact] = await prismaClient.studyArtifact.updateManyAndReturn({
    where: {
      id: artifactId,
      OR: [{ status: { notIn: ['PENDING', 'RUNNING'] } }, { updatedAt: { lt: staleBefore } }],
    },
    data: { status: 'PENDING', error: null },
  });
  return artifact ?? null;
}

export async function deleteArtifact(artifactId: string) {
  await prismaClient.studyArtifact.deleteMany({ where: { id: artifactId } });
}

/** Of these sources, the ones in the workspace, with what gathering needs to know. */
export async function findWorkspaceSources(workspaceId: string, sourceIds: string[]) {
  return prismaClient.source.findMany({
    where: { workspaceId, id: { in: sourceIds } },
    select: { id: true, title: true, type: true, status: true },
  });
}

// ---- gathering --------------------------------------------------------------------------

const passageSelect = {
  id: true,
  sourceId: true,
  content: true,
  headingPath: true,
  pageStart: true,
  pageEnd: true,
  lineStart: true,
  lineEnd: true,
  tokenCount: true,
  document: { select: { path: true } },
} satisfies Prisma.SourceChunkSelect;

export type PassageRow = Prisma.SourceChunkGetPayload<{ select: typeof passageSelect }>;

/** The TOC node with the titles of its ancestors, root first; null when it isn't there. */
export async function findTocPath(sourceIds: string[], tocNodeId: string) {
  const node = await prismaClient.tocNode.findFirst({
    where: { id: tocNodeId, sourceId: { in: sourceIds } },
    select: { sourceId: true, documentId: true, parentId: true, title: true },
  });
  if (!node) return null;
  const titles = [node.title];
  for (let parentId = node.parentId; parentId;) {
    const parent = await prismaClient.tocNode.findUnique({
      where: { id: parentId },
      select: { parentId: true, title: true },
    });
    if (!parent) break;
    titles.unshift(parent.title);
    parentId = parent.parentId;
  }
  return { sourceId: node.sourceId, documentId: node.documentId, titles };
}

// Candidates are listed with their sizes only, so a large selection can be sampled down
// before any text is loaded.
export type Candidate = { id: string; tokenCount: number };

/**
 * Parent chunks of a TOC section, subsections included: the chunker gives each parent the
 * titles of the sections it sits in, so a section's parents are those whose heading path
 * starts with the section's own.
 */
export async function listSectionParents(documentId: string, titles: string[]) {
  return prismaClient.$queryRaw<Candidate[]>`
    SELECT id, "tokenCount" FROM "SourceChunk"
    WHERE "documentId" = ${documentId} AND kind = 'PARENT'
      AND "headingPath"[1:${titles.length}::int] = ${titles}::text[]
    ORDER BY ordinal
  `;
}

/** Parent chunks of the files under a folder, in file and reading order. */
export async function listFolderParents(sourceIds: string[], pathPrefix: string) {
  return prismaClient.sourceChunk.findMany({
    where: {
      sourceId: { in: sourceIds },
      kind: 'PARENT',
      document: { path: { startsWith: pathPrefix } },
    },
    select: { id: true, tokenCount: true },
    orderBy: [{ document: { path: 'asc' } }, { ordinal: 'asc' }],
  });
}

/** A source's parent chunks in reading order. */
export async function listSourceParents(sourceId: string) {
  return prismaClient.sourceChunk.findMany({
    where: { sourceId, kind: 'PARENT' },
    select: { id: true, tokenCount: true },
    orderBy: [{ document: { path: 'asc' } }, { ordinal: 'asc' }],
  });
}

/** These chunks, in the order given. */
export async function findPassages(ids: string[]) {
  const rows = await prismaClient.sourceChunk.findMany({
    where: { id: { in: ids } },
    select: passageSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
