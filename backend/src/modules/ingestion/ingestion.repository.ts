import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';
import { Prisma, type IngestStage } from '../../generated/prisma/client.js';
import { graphRows, indexRows } from './indexRows.js';
import type { Draft, DraftGraph, IndexedChild } from './ingestion.types.js';

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

/**
 * Stores the parsed source (and a repository's code graph) for this run, replacing any older
 * run's draft. False when the source is gone.
 */
export async function saveDraft(sourceId: string, runId: string, draft: Draft, graph?: DraftGraph) {
  const data = draft as unknown as Prisma.InputJsonValue;
  const graphData = graph ? (graph as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  try {
    await prismaClient.ingestDraft.upsert({
      where: { sourceId },
      create: { sourceId, runId, data, graph: graphData },
      update: { runId, data, graph: graphData },
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
  const row = await prismaClient.ingestDraft.findUnique({
    where: { sourceId },
    select: { runId: true, data: true },
  });
  return row?.runId === runId ? (row.data as unknown as Draft) : null;
}

/** The code graph saved with the draft. The index transaction checks the run owns it. */
export async function loadGraph(sourceId: string) {
  const row = await prismaClient.ingestDraft.findUnique({
    where: { sourceId },
    select: { graph: true },
  });
  return (row?.graph ?? null) as unknown as DraftGraph | null;
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

type IndexInput = {
  sourceId: string;
  runId: string;
  workspaceId: string;
  draft: Draft;
  // By child id.
  children: Map<string, IndexedChild>;
  graph: DraftGraph | null;
  stats: Prisma.InputJsonValue;
};

const INSERT_BATCH = 500;
const DOCUMENT_BATCH = 50;

/**
 * Swaps the source's documents, TOC and chunks for the draft's in one transaction and marks
 * it READY, so readers see the old index or the new one, never a mix. 'gone' when the source
 * was deleted, 'superseded' when another run owns the draft now.
 */
export async function writeIndex(input: IndexInput): Promise<'done' | 'gone' | 'superseded'> {
  const { sourceId, runId, draft } = input;
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

      // Chunks, TOC nodes and the code graph go with their documents.
      await tx.sourceDocument.deleteMany({ where: { sourceId } });

      // Inserted in batches across all documents: a repository has hundreds of files.
      const { documents, tocNodes, parents, children } = indexRows(input);
      // Documents can be large (a whole book), so they go in smaller batches.
      for (let i = 0; i < documents.length; i += DOCUMENT_BATCH) {
        await tx.sourceDocument.createMany({ data: documents.slice(i, i + DOCUMENT_BATCH) });
      }
      for (let i = 0; i < tocNodes.length; i += INSERT_BATCH) {
        await tx.tocNode.createMany({ data: tocNodes.slice(i, i + INSERT_BATCH) });
      }
      for (const rows of [parents, children]) {
        for (let i = 0; i < rows.length; i += INSERT_BATCH) {
          await tx.sourceChunk.createMany({ data: rows.slice(i, i + INSERT_BATCH) });
        }
      }

      // Symbols before edges, which point at them.
      const { symbols, edges } = graphRows(sourceId, input.graph);
      for (let i = 0; i < symbols.length; i += INSERT_BATCH) {
        await tx.codeSymbol.createMany({ data: symbols.slice(i, i + INSERT_BATCH) });
      }
      for (let i = 0; i < edges.length; i += INSERT_BATCH) {
        await tx.codeEdge.createMany({ data: edges.slice(i, i + INSERT_BATCH) });
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
