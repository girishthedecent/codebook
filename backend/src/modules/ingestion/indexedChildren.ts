import { embeddingCacheKey, embeddingInput } from '../../llm/embeddings.js';
import { identifierWords } from './code/identifiers.js';
import { contextKeysFor, isRepo } from './contextUnits.js';
import { chunkText } from './doc.chunker.js';
import { findContexts } from './ingestion.repository.js';
import type { Draft, IndexedChild } from './ingestion.types.js';

// What search will index for each child: its context, heading path and text (plus spelled-out
// identifiers for code), and the embedding key of that text. The embed and index steps both
// build it, so their keys match.

/** Each child's context (as cached now), search text and embedding key, by child id. */
export async function indexedChildren(draft: Draft) {
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
      const input = embeddingInput(searchText, 'document', draft.title);
      children.set(child.id, {
        context,
        searchText,
        embeddingKey: embeddingCacheKey('document', input),
      });
    }
  }
  return children;
}
