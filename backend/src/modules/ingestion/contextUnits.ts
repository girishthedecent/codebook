import { appConfig } from '../../config/app.config.js';
import {
  codeContextKey,
  contextKeys,
  type CodePack,
  type ParentToContextualize,
} from './contextualizer.js';
import { chunkText } from './doc.chunker.js';
import type { Draft, DraftDocument } from './ingestion.types.js';

// What the contextualize steps send to the model and under which cache keys, worked out
// from the draft alone, so every step (and every replay of one) sees the same units.

type ParentGroup = {
  doc: DraftDocument;
  parent: ParentToContextualize;
  // The parent's children, in the same order as parent.children.
  children: DraftDocument['children'];
};

// What one contextualize call covers: a PDF parent with its children, or a pack of
// repository chunks.
type ContextUnit = { kind: 'parent'; group: ParentGroup } | { kind: 'pack'; pack: CodePack };

export const isRepo = (draft: Draft) => draft.sourceType === 'GITHUB_REPO';

export function unitsPerStep(draft: Draft) {
  const { packsPerStep, parentsPerStep } = appConfig.ingestion.contextualize;
  return isRepo(draft) ? packsPerStep : parentsPerStep;
}

/**
 * The draft's contextualize calls, in a fixed order that only depends on the draft: the
 * prepare step counts them and each contextualize step takes its slice, so the two agree.
 */
export function contextUnitsFor(draft: Draft): ContextUnit[] {
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
export function contextKeysFor(draft: Draft) {
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
