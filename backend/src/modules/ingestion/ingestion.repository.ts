import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';
import { Prisma, type IngestStage } from '../../generated/prisma/client.js';
import type { Draft } from './ingestion.types.js';
import { chunkText } from './doc.chunker.js';

// Ingestion owns a source's ingest state (status, stage, progress, hash, stats) and its
// documents, TOC and chunks; the sources module owns the rest of the source's life.

export async function findIngestSource(sourceId: string) {
  return prismaClient.source.findUnique({
    where: { id: sourceId },
    include: { workspace: { select: { userId: true } } },
  });
}

/**
 * Updates ingestion state. False when the source is gone (deleted while queued or
 * running), so the job can stop instead of failing.
 */
export async function setIngestState(sourceId: string, data: Prisma.SourceUpdateManyMutationInput) {
  const { count } = await prismaClient.source.updateMany({ where: { id: sourceId }, data });
  return count > 0;
}

// ---- draft ------------------------------------------------------------------------------

/** Stores the parsed source for this run, replacing any older run's draft. False when the source is gone. */
export async function saveDraft(sourceId: string, runId: string, draft: Draft) {
  const data = draft as unknown as Prisma.InputJsonValue;
  try {
    await prismaClient.ingestDraft.upsert({
      where: { sourceId },
      create: { sourceId, runId, data },
      update: { runId, data },
    });
    return true;
  } catch (error) {
    // Foreign key: the source was deleted while it was being parsed.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return false;
    }
    throw error;
  }
}

/** This run's draft, or null when the source is gone or a newer run has taken over. */
export async function loadDraft(sourceId: string, runId: string) {
  const row = await prismaClient.ingestDraft.findUnique({ where: { sourceId } });
  return row?.runId === runId ? (row.data as unknown as Draft) : null;
}

// ---- context cache ----------------------------------------------------------------------

export async function findContexts(keys: string[]) {
  if (keys.length === 0) return new Map<string, string>();
  const rows = await prismaClient.contextCache.findMany({ where: { key: { in: keys } } });
  return new Map(rows.map((row) => [row.key, row.context]));
}

export async function saveContexts(entries: { key: string; context: string }[]) {
  if (entries.length === 0) return;
  await prismaClient.contextCache.createMany({ data: entries, skipDuplicates: true });
}

// ---- index ------------------------------------------------------------------------------

export type IndexedChild = {
  context: string | null;
  searchText: string;
  // EmbeddingCache key of the child's vector, which the transaction copies in SQL.
  embeddingKey: string;
};

type IndexInput = {
  sourceId: string;
  runId: string;
  workspaceId: string;
  draft: Draft;
  // By child id.
  children: Map<string, IndexedChild>;
  stats: Prisma.InputJsonValue;
};

const INSERT_BATCH = 500;

/**
 * Swaps the source's documents, TOC and chunks for the draft's in one transaction and marks
 * it READY, so readers see the old index or the new one, never a mix. 'gone' when the source
 * was deleted, 'superseded' when another run owns the draft now.
 */
export async function writeIndex(input: IndexInput): Promise<'done' | 'gone' | 'superseded'> {
  const { sourceId, runId, workspaceId, draft } = input;
  return prismaClient.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<unknown[]>`
        SELECT 1 FROM "Source" WHERE id = ${sourceId} FOR UPDATE
      `;
      if (locked.length === 0) return 'gone';
      const owner = await tx.ingestDraft.findUnique({
        where: { sourceId },
        select: { runId: true },
      });
      if (owner?.runId !== runId) return 'superseded';

      // Chunks and TOC nodes go with their documents.
      await tx.sourceDocument.deleteMany({ where: { sourceId } });

      for (const doc of draft.documents) {
        await tx.sourceDocument.create({
          data: {
            id: doc.id,
            sourceId,
            path: doc.path,
            language: doc.language,
            content: doc.content,
            pageStart: doc.pageStart,
            pageEnd: doc.pageEnd,
            lineCount: doc.lineCount,
            sizeBytes: Buffer.byteLength(doc.content),
            hash: doc.hash,
          },
        });
        // In reading order, so a node's parent is always inserted before it.
        await tx.tocNode.createMany({
          data: doc.toc.map((entry, ordinal) => ({
            id: entry.id,
            sourceId,
            documentId: doc.id,
            parentId: entry.parentIndex === null ? null : doc.toc[entry.parentIndex]!.id,
            title: entry.title,
            number: entry.number,
            level: entry.level,
            ordinal,
            pageStart: entry.pageStart,
            pageEnd: entry.pageEnd,
            charStart: entry.charStart,
            charEnd: entry.charEnd,
          })),
        });

        const base = { sourceId, documentId: doc.id, workspaceId };
        const parents = doc.parents.map((parent, ordinal) => ({
          ...base,
          id: parent.id,
          kind: 'PARENT' as const,
          ordinal,
          content: chunkText(doc.content, parent.start, parent.end),
          headingPath: parent.headingPath,
          pageStart: parent.pageStart,
          pageEnd: parent.pageEnd,
          tokenCount: parent.tokenCount,
          hash: parent.hash,
          searchText: '',
        }));
        const children = doc.children.map((child, ordinal) => {
          const indexed = input.children.get(child.id)!;
          return {
            ...base,
            id: child.id,
            parentId: doc.parents[child.parentIndex]!.id,
            kind: 'CHILD' as const,
            ordinal,
            content: chunkText(doc.content, child.start, child.end),
            context: indexed.context,
            headingPath: child.headingPath,
            pageStart: child.pageStart,
            pageEnd: child.pageEnd,
            tokenCount: child.tokenCount,
            hash: child.hash,
            searchText: indexed.searchText,
          };
        });
        for (const rows of [parents, children]) {
          for (let i = 0; i < rows.length; i += INSERT_BATCH) {
            await tx.sourceChunk.createMany({ data: rows.slice(i, i + INSERT_BATCH) });
          }
        }
      }

      // Vectors are already in the embedding cache; copy them inside Postgres rather than
      // sending ~6 KB per chunk to the database and back.
      const ids = [...input.children.keys()];
      const keys = ids.map((id) => input.children.get(id)!.embeddingKey);
      const copied = await tx.$executeRaw`
        UPDATE "SourceChunk" AS c SET embedding = ec.embedding
        FROM unnest(${ids}::text[], ${keys}::text[]) AS v(id, key)
        JOIN "EmbeddingCache" AS ec ON ec.key = v.key
        WHERE c.id = v.id
      `;
      if (copied !== ids.length) {
        throw new Error(`Embeddings missing for ${ids.length - copied} of ${ids.length} chunks`);
      }

      await tx.source.update({
        where: { id: sourceId },
        data: {
          status: 'READY',
          stage: 'DONE',
          progress: 100,
          error: null,
          contentHash: draft.contentHash,
          ingestVersion: appConfig.ingestion.version,
          stats: input.stats,
          lastIngestedAt: new Date(),
        },
      });
      await tx.ingestDraft.delete({ where: { sourceId } });
      return 'done';
    },
    { timeout: appConfig.ingestion.indexTimeoutMs, maxWait: 10_000 },
  );
}

/**
 * Marks the source FAILED after a run gave up, unless a newer run has taken over: it owns
 * the draft, or it already finished after the failed run was queued (`queuedAt`). A stale
 * run failing must not clobber either. Returns the stage it failed in.
 */
export async function failIngest(
  sourceId: string,
  runId: string,
  queuedAt: Date,
  errorFor: (stage: IngestStage) => string,
) {
  return prismaClient.$transaction(async (tx) => {
    const [source] = await tx.$queryRaw<{ stage: IngestStage; lastIngestedAt: Date | null }[]>`
      SELECT stage::text AS stage, "lastIngestedAt" FROM "Source" WHERE id = ${sourceId} FOR UPDATE
    `;
    if (!source) return null;
    if (source.lastIngestedAt && source.lastIngestedAt > queuedAt) return null;
    const draft = await tx.ingestDraft.findUnique({ where: { sourceId }, select: { runId: true } });
    if (draft && draft.runId !== runId) return null;

    await tx.source.update({
      where: { id: sourceId },
      data: { status: 'FAILED', error: errorFor(source.stage) },
    });
    await tx.ingestDraft.deleteMany({ where: { sourceId } });
    return source.stage;
  });
}
