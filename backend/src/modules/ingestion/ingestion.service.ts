import { appConfig } from '../../config/app.config.js';
import type { IngestStage, Prisma, SourceType } from '../../generated/prisma/client.js';
import { embedTexts, embeddingCacheKey, withTaskPrefix } from '../../llm/embeddings.js';
import type { AdapterContext, AdapterResult } from './adapters/adapter.js';
import { preparePdf } from './adapters/pdf.adapter.js';
import { prepareRepo } from './adapters/repo.adapter.js';
import { identifierWords } from './code/identifiers.js';
import {
  codeContextKey,
  contextKeys,
  contextualizePack,
  contextualizeParent,
  type CodePack,
  type ParentToContextualize,
} from './contextualizer.js';
import { chunkText } from './doc.chunker.js';
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

  const draft: Draft = {
    sourceType: source.type === 'GITHUB_REPO' ? 'GITHUB_REPO' : 'PDF',
    ...(result.repo && { repo: result.repo }),
    title: source.title,
    userId: source.workspace.userId,
    workspaceId: source.workspaceId,
    contentHash: result.contentHash,
    documents: result.documents,
  };
  if (!(await saveDraft(sourceId, runId, draft))) return { outcome: 'gone' };

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
      return Promise.resolve({ outcome: 'failed', error: "Websites can't be ingested yet" });
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
    : { pages: documents.reduce((sum, doc) => sum + (doc.pageEnd ?? 0), 0), ...counts };

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

// What one contextualize call covers: a PDF parent with its children, or a pack of
// repository chunks.
type ContextUnit = { kind: 'parent'; group: ParentGroup } | { kind: 'pack'; pack: CodePack };

const isRepo = (draft: Draft) => draft.sourceType === 'GITHUB_REPO';

function unitsPerStep(draft: Draft) {
  const { packsPerStep, parentsPerStep } = appConfig.ingestion.contextualize;
  return isRepo(draft) ? packsPerStep : parentsPerStep;
}

/**
 * The draft's contextualize calls, in a fixed order that only depends on the draft: the
 * prepare step counts them and each contextualize step takes its slice, so the two agree.
 */
function contextUnitsFor(draft: Draft): ContextUnit[] {
  if (!isRepo(draft)) return parentGroups(draft).map((group) => ({ kind: 'parent', group }));
  return codePacks(draft).map((pack) => ({ kind: 'pack', pack }));
}

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

// Every repository chunk in path order, cut into packs of a few chunks: small files share
// a call, a big file spans several.
function codePacks(draft: Draft): CodePack[] {
  const { codeChunksPerCall, codeTokensPerCall } = appConfig.ingestion.contextualize;
  const packs: CodePack[] = [];
  let current: CodePack['items'] = [];
  let tokens = 0;
  for (const doc of draft.documents) {
    const file = { path: doc.path, outline: doc.outline ?? '' };
    for (const child of doc.children) {
      const full =
        current.length >= codeChunksPerCall ||
        (current.length > 0 && tokens + child.tokenCount > codeTokensPerCall);
      if (full) {
        packs.push({ title: draft.title, items: current });
        current = [];
        tokens = 0;
      }
      current.push({
        file,
        chunk: { hash: child.hash, text: chunkText(doc.content, child.start, child.end) },
      });
      tokens += child.tokenCount;
    }
  }
  if (current.length > 0) packs.push({ title: draft.title, items: current });
  return packs;
}

/** Each child's context cache key, by child id; empty when contextual retrieval is off. */
function contextKeysFor(draft: Draft) {
  const keys = new Map<string, string>();
  if (!appConfig.ingestion.contextualRetrieval) return keys;
  if (isRepo(draft)) {
    for (const doc of draft.documents) {
      const file = { path: doc.path, outline: doc.outline ?? '' };
      for (const child of doc.children) {
        keys.set(child.id, codeContextKey(draft.title, file, child.hash));
      }
    }
    return keys;
  }
  for (const group of parentGroups(draft)) {
    const groupKeys = contextKeys(group.parent);
    group.children.forEach((child, i) => keys.set(child.id, groupKeys[i]!));
  }
  return keys;
}

/** Each child's context (as cached now), search text and embedding key, by child id. */
async function indexedChildren(draft: Draft) {
  const keys = contextKeysFor(draft);
  const contexts = await findContexts([...keys.values()]);
  const repo = isRepo(draft);

  // Keyed by child id; insertion follows document order.
  const children = new Map<string, IndexedChild>();
  for (const doc of draft.documents) {
    for (const child of doc.children) {
      const key = keys.get(child.id);
      const context = (key && contexts.get(key)) || null;
      const content = chunkText(doc.content, child.start, child.end);
      const searchText = [
        context,
        child.headingPath.join(' > '),
        // Code identifiers spelled out, so keyword search finds them by their words.
        repo ? identifierWords(content).join(', ') : null,
        content,
      ]
        .filter(Boolean)
        .join('\n');
      const input = withTaskPrefix(searchText, 'document', draft.title);
      children.set(child.id, {
        context,
        searchText,
        embeddingKey: embeddingCacheKey('document', input),
      });
    }
  }
  return children;
}
