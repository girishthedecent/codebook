import { randomUUID } from 'node:crypto';
import { appConfig } from '../../config/app.config.js';
import type { IngestStage, Prisma, SourceType } from '../../generated/prisma/client.js';
import { embedTexts, embeddingCacheKey, withTaskPrefix } from '../../llm/embeddings.js';
import { embeddingRoute, textRoutes } from '../../llm/models.js';
import { contextualizePrompt } from '../../llm/prompts/contextualize.js';
import { sha256 } from '../../utils/hash.js';
import { getObjectBuffer } from '../../utils/storage.js';
import type { PdfOrigin } from '../sources/source.dto.js';
import { contextKeys, contextualizeParent, type ParentToContextualize } from './contextualizer.js';
import { chunkDocument, chunkText } from './doc.chunker.js';
import {
  failIngest,
  findContexts,
  findIngestSource,
  loadDraft,
  saveDraft,
  setIngestState,
  writeIndex,
  type IndexedChild,
} from './ingestion.repository.js';
import type { Draft, DraftDocument } from './ingestion.types.js';
import { readPdf, PdfReadError } from './pdf/pdf.parser.js';
import { cleanPages, hasTextLayer } from './pdf/pdf.text.js';
import { buildToc, outlineHeadings } from './toc.js';

// Each function below is one Inngest step of the ingest run (see ingest.function.ts). They
// return small plain objects only: Inngest stores step results, and big data lives in the
// draft row instead.

const UNSUPPORTED: Partial<Record<SourceType, string>> = {
  GITHUB_REPO: "GitHub repositories can't be ingested yet",
  WEBSITE: "Websites can't be ingested yet",
};

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
 * Downloads and parses the file, builds the TOC and the chunk plan, and stores them as this
 * run's draft. Stops early when the content is unchanged since the last complete ingest, or
 * when the file can't be ingested (then the source is FAILED with a message for the user).
 */
export async function prepareSource(sourceId: string, runId: string): Promise<Prepared> {
  const source = await findIngestSource(sourceId);
  if (!source) return { outcome: 'gone' };

  const fail = async (error: string) => {
    await setIngestState(sourceId, { status: 'FAILED', error });
    return { outcome: 'failed' } as const;
  };
  const unsupported = UNSUPPORTED[source.type];
  if (unsupported) return fail(unsupported);

  const origin = source.origin as PdfOrigin;
  if (!origin.storageKey) {
    return fail("The PDF upload didn't finish. Delete this source and upload it again.");
  }
  await setIngestState(sourceId, { stage: 'FETCHING', progress: 2 });
  const file = await getObjectBuffer(origin.storageKey);
  if (!file) return fail('The uploaded file is missing. Delete this source and upload it again.');

  await setIngestState(sourceId, { stage: 'PARSING', progress: 5 });
  let raw;
  try {
    raw = await readPdf(file);
  } catch (error) {
    if (error instanceof PdfReadError) return fail(error.message);
    throw error;
  }
  if (!hasTextLayer(raw.pages)) {
    return fail("This PDF has no text layer (scanned pages need OCR, which isn't supported)");
  }

  await setIngestState(sourceId, { stage: 'STRUCTURING', progress: 8 });
  const headings = outlineHeadings(raw.outline);
  const pages = cleanPages(raw.pages, headings);
  const toc = buildToc(pages, headings);

  await setIngestState(sourceId, { stage: 'CHUNKING', progress: 10 });
  const content = pages.join('\f');
  const contentHash = ingestHash(source.title, [content]);
  const stats = source.stats as { missingContexts?: number };
  if (
    source.contentHash === contentHash &&
    source.lastIngestedAt &&
    (stats.missingContexts ?? 0) === 0
  ) {
    await setIngestState(sourceId, {
      status: 'READY',
      stage: 'DONE',
      progress: 100,
      error: null,
      lastIngestedAt: new Date(),
    });
    return { outcome: 'skipped' };
  }

  const plan = chunkDocument(content, toc);
  const document: DraftDocument = {
    id: randomUUID(),
    path: origin.fileName,
    language: null,
    content,
    pageStart: 1,
    pageEnd: pages.length,
    lineCount: null,
    hash: sha256(content),
    toc: toc.map((entry) => ({ ...entry, id: randomUUID() })),
    parents: plan.parents.map((parent) => ({
      ...parent,
      id: randomUUID(),
      hash: sha256(chunkText(content, parent.start, parent.end)),
    })),
    children: plan.children.map((child) => ({
      ...child,
      id: randomUUID(),
      hash: sha256(chunkText(content, child.start, child.end)),
    })),
  };
  const draft: Draft = {
    title: source.title,
    userId: source.workspace.userId,
    workspaceId: source.workspaceId,
    contentHash,
    documents: [document],
  };
  if (!(await saveDraft(sourceId, runId, draft))) return { outcome: 'gone' };

  const { parentsPerStep } = appConfig.ingestion.contextualize;
  const contextual = appConfig.ingestion.contextualRetrieval;
  return {
    outcome: 'draft',
    contextSteps: contextual ? Math.ceil(document.parents.length / parentsPerStep) : 0,
    embedSteps: Math.ceil(document.children.length / appConfig.ingestion.childrenPerEmbedStep),
  };
}

/**
 * Everything that changes what the index would contain, so a resync with nothing new can
 * skip the work. Bump `ingestion.version` for changes in code that these don't capture.
 */
export function ingestHash(title: string, contents: string[]) {
  const settings = {
    version: appConfig.ingestion.version,
    chunking: appConfig.ingestion.chunking,
    contextualRetrieval: appConfig.ingestion.contextualRetrieval,
    contextModel: textRoutes.contextualize.primary.model,
    contextPrompt: contextualizePrompt.id,
    embeddingModel: embeddingRoute.model.model,
    dimensions: embeddingRoute.dimensions,
  };
  return sha256(JSON.stringify(settings), title, ...contents);
}

/**
 * Contextualizes one batch of parents. Null when this run has no draft any more (the
 * source was deleted or a newer run took over); likewise for the steps below.
 */
export async function contextualizeStep(sourceId: string, runId: string, step: number) {
  const draft = await loadDraft(sourceId, runId);
  if (!draft) return null;

  const { parentsPerStep } = appConfig.ingestion.contextualize;
  const groups = parentGroups(draft);
  const steps = Math.ceil(groups.length / parentsPerStep);
  // Stage and progress as the step starts, so a failure is reported against this stage.
  await setIngestState(sourceId, {
    stage: 'CONTEXTUALIZING',
    progress: 10 + Math.round((50 * step) / steps),
  });

  const batch = groups.slice(step * parentsPerStep, (step + 1) * parentsPerStep);
  let done = 0;
  let failed = 0;
  for (const { parent } of batch) {
    if (await contextualizeParent(parent, callContext(draft))) done++;
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

  const contextual = appConfig.ingestion.contextualRetrieval;
  const missingContexts = contextual
    ? [...children.values()].filter((child) => child.context === null).length
    : 0;
  const documents = draft.documents;
  const stats = {
    pages: documents.reduce((sum, doc) => sum + (doc.pageEnd ?? 0), 0),
    documents: documents.length,
    parentChunks: documents.reduce((sum, doc) => sum + doc.parents.length, 0),
    chunks: children.size,
    tokens: documents.reduce(
      (sum, doc) => sum + doc.parents.reduce((total, parent) => total + parent.tokenCount, 0),
      0,
    ),
    missingContexts,
  } satisfies Prisma.InputJsonObject;

  const outcome = await writeIndex({
    sourceId,
    runId,
    workspaceId: draft.workspaceId,
    draft,
    children,
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

type ParentGroup = {
  doc: DraftDocument;
  parent: ParentToContextualize;
  // The parent's children, in the same order as parent.children.
  children: DraftDocument['children'];
};

// Every parent with its children, in document order.
function parentGroups(draft: Draft): ParentGroup[] {
  return draft.documents.flatMap((doc) => {
    const byParent = doc.parents.map((): DraftDocument['children'] => []);
    for (const child of doc.children) byParent[child.parentIndex]!.push(child);
    return doc.parents.map((parent, index) => ({
      doc,
      parent: {
        title: draft.title,
        headingPath: parent.headingPath,
        text: chunkText(doc.content, parent.start, parent.end),
        children: byParent[index]!.map((child) => ({
          hash: child.hash,
          text: chunkText(doc.content, child.start, child.end),
        })),
      },
      children: byParent[index]!,
    }));
  });
}

/** Each child's context (as cached now), search text and embedding key, by child id. */
async function indexedChildren(draft: Draft) {
  const groups = parentGroups(draft);
  const contextual = appConfig.ingestion.contextualRetrieval;
  const keys = groups.map((group) => (contextual ? contextKeys(group.parent) : []));
  const contexts = await findContexts(keys.flat());

  // Keyed by child id; insertion follows document order.
  const children = new Map<string, IndexedChild>();
  groups.forEach((group, g) =>
    group.children.forEach((child, i) => {
      const key = keys[g]![i];
      const context = (key && contexts.get(key)) || null;
      const searchText = [
        context,
        child.headingPath.join(' > '),
        chunkText(group.doc.content, child.start, child.end),
      ]
        .filter(Boolean)
        .join('\n');
      const input = withTaskPrefix(searchText, 'document', draft.title);
      children.set(child.id, {
        context,
        searchText,
        embeddingKey: embeddingCacheKey('document', input),
      });
    }),
  );
  return children;
}
