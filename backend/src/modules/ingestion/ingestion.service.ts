import { appConfig } from '../../config/app.config.js';
import type { IngestStage, Prisma, SourceType } from '../../generated/prisma/client.js';
import { embedTexts } from '../../llm/embeddings.js';
import type { AdapterContext, AdapterResult } from './adapters/adapter.js';
import { preparePdf } from './adapters/pdf.adapter.js';
import { prepareRepo } from './adapters/repo.adapter.js';
import { prepareWebsite } from './adapters/website.adapter.js';
import { contextUnitsFor, unitsPerStep } from './contextUnits.js';
import { contextualizePack, contextualizeParent } from './contextualizer.js';
import { indexedChildren } from './indexedChildren.js';
import {
  failIngest,
  findIngestSource,
  loadDraft,
  loadGraph,
  saveDraft,
  setIngestState,
  writeIndex,
} from './ingestion.repository.js';
import type { Draft } from './ingestion.types.js';

export { ingestHash } from './contentHash.js';

// Each function below is one Inngest step of the ingest run (see ingest.function.ts). They
// return small plain objects only: Inngest stores step results, and big data lives in the
// draft row instead.

export type Prepared =
  | { outcome: 'draft'; contextSteps: number; embedSteps: number }
  | { outcome: 'skipped' | 'failed' | 'gone' };

/** Marks the source PROCESSING. False when it was deleted after being queued. */
export async function startIngest(sourceId: string) {
  return setIngestState(sourceId, {
    status: 'PROCESSING',
    stage: 'FETCHING',
    progress: 0,
    error: null,
  });
}

/**
 * Fetches and parses the source with its type's adapter (TOC, chunk plan) and stores the
 * result as this run's draft. Stops early when the content is unchanged since the last
 * complete ingest, or when it can't be ingested (then the source is FAILED with a message
 * for the user).
 */
export async function prepareSource(sourceId: string, runId: string): Promise<Prepared> {
  const source = await findIngestSource(sourceId);
  if (!source) return { outcome: 'gone' };

  const stats = source.stats as { missingContexts?: number };
  const ctx: AdapterContext = {
    stage: (stage: IngestStage, progress: number) => setIngestState(sourceId, { stage, progress }),
    unchanged: (contentHash) =>
      source.contentHash === contentHash &&
      source.lastIngestedAt !== null &&
      (stats.missingContexts ?? 0) === 0,
  };
  const result = await prepareByType(source.type, source, ctx);

  if (result.outcome === 'failed') {
    await setIngestState(sourceId, { status: 'FAILED', error: result.error });
    return { outcome: 'failed' };
  }
  if (result.outcome === 'unchanged') {
    await setIngestState(sourceId, {
      status: 'READY',
      stage: 'DONE',
      progress: 100,
      error: null,
      lastIngestedAt: new Date(),
    });
    return { outcome: 'skipped' };
  }

  if (result.title && result.title !== source.title) {
    await setIngestState(sourceId, { title: result.title });
  }
  const draft: Draft = {
    sourceType: source.type,
    ...(result.repo && { repo: result.repo }),
    ...(result.website && { website: result.website }),
    title: result.title ?? source.title,
    userId: source.workspace.userId,
    workspaceId: source.workspaceId,
    contentHash: result.contentHash,
    documents: result.documents,
  };
  if (!(await saveDraft(sourceId, runId, draft, result.graph))) return { outcome: 'gone' };

  const contextual = appConfig.ingestion.contextualRetrieval;
  const children = draft.documents.reduce((sum, doc) => sum + doc.children.length, 0);
  return {
    outcome: 'draft',
    contextSteps: contextual ? Math.ceil(contextUnitsFor(draft).length / unitsPerStep(draft)) : 0,
    embedSteps: Math.ceil(children / appConfig.ingestion.childrenPerEmbedStep),
  };
}

function prepareByType(
  type: SourceType,
  source: Parameters<typeof preparePdf>[0],
  ctx: AdapterContext,
): Promise<AdapterResult> {
  switch (type) {
    case 'PDF':
      return preparePdf(source, ctx);
    case 'GITHUB_REPO':
      return prepareRepo(source, ctx);
    case 'WEBSITE':
      return prepareWebsite(source, ctx);
  }
}

/**
 * Contextualizes one batch of parents. Null when this run has no draft any more (the
 * source was deleted or a newer run took over); likewise for the steps below.
 */
export async function contextualizeStep(sourceId: string, runId: string, step: number) {
  const draft = await loadDraft(sourceId, runId);
  if (!draft) return null;

  const units = contextUnitsFor(draft);
  const perStep = unitsPerStep(draft);
  const steps = Math.ceil(units.length / perStep);
  // Stage and progress as the step starts, so a failure is reported against this stage.
  await setIngestState(sourceId, {
    stage: 'CONTEXTUALIZING',
    progress: 10 + Math.round((50 * step) / steps),
  });

  let done = 0;
  let failed = 0;
  for (const unit of units.slice(step * perStep, (step + 1) * perStep)) {
    const ok =
      unit.kind === 'parent'
        ? await contextualizeParent(unit.group.parent, callContext(draft))
        : await contextualizePack(unit.pack, callContext(draft));
    if (ok) done++;
    else failed++;
  }
  return { done, failed };
}

/** Embeds one batch of children, which leaves the vectors in the embedding cache. */
export async function embedStep(sourceId: string, runId: string, step: number) {
  const draft = await loadDraft(sourceId, runId);
  if (!draft) return null;

  const perStep = appConfig.ingestion.childrenPerEmbedStep;
  const children = await indexedChildren(draft);
  const steps = Math.ceil(children.size / perStep);
  await setIngestState(sourceId, {
    stage: 'EMBEDDING',
    progress: 60 + Math.round((30 * step) / steps),
  });

  const batch = [...children.values()].slice(step * perStep, (step + 1) * perStep);
  await embedTexts(
    batch.map((child) => child.searchText),
    { kind: 'document', title: draft.title, ctx: callContext(draft) },
  );
  return { embedded: batch.length };
}

/**
 * Builds the final search texts from the contexts cached right now, makes sure each has a
 * vector (normally all cached by the embed steps; a context written since then by another
 * run of the same text means a new vector), and swaps the new index in.
 */
export async function indexStep(sourceId: string, runId: string) {
  const draft = await loadDraft(sourceId, runId);
  if (!draft) return { outcome: 'stopped' as const };
  if (!(await setIngestState(sourceId, { stage: 'INDEXING', progress: 95 }))) {
    return { outcome: 'gone' as const };
  }

  const children = await indexedChildren(draft);
  await embedTexts(
    [...children.values()].map((child) => child.searchText),
    { kind: 'document', title: draft.title, ctx: callContext(draft) },
  );
  const graph = draft.repo ? await loadGraph(sourceId) : null;

  const contextual = appConfig.ingestion.contextualRetrieval;
  const missingContexts = contextual
    ? [...children.values()].filter((child) => child.context === null).length
    : 0;
  const documents = draft.documents;
  const counts = {
    documents: documents.length,
    parentChunks: documents.reduce((sum, doc) => sum + doc.parents.length, 0),
    chunks: children.size,
    tokens: documents.reduce(
      (sum, doc) => sum + doc.parents.reduce((total, parent) => total + parent.tokenCount, 0),
      0,
    ),
    missingContexts,
  };
  const stats: Prisma.InputJsonObject = draft.repo
    ? { ...draft.repo, ...counts }
    : draft.website
      ? { ...draft.website, ...counts }
      : { pages: documents.reduce((sum, doc) => sum + (doc.pageEnd ?? 0), 0), ...counts };

  const outcome = await writeIndex({
    sourceId,
    runId,
    workspaceId: draft.workspaceId,
    draft,
    children,
    graph,
    stats,
  });
  return { outcome, ...stats };
}

const EMBEDDING_FAILED =
  "Creating embeddings failed (the provider's daily limit may be reached). " +
  'Try a resync later; finished batches are kept.';

/** After a run gave up for good. Leaves the previous index (if any) in place. */
export async function failIngestService(sourceId: string, runId: string, queuedAt: Date) {
  return failIngest(sourceId, runId, queuedAt, (stage: IngestStage) =>
    stage === 'EMBEDDING' ? EMBEDDING_FAILED : 'Processing failed. Try a resync.',
  );
}

function callContext(draft: Draft) {
  return { userId: draft.userId, workspaceId: draft.workspaceId };
}
