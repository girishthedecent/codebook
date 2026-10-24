import { chunkText } from './doc.chunker.js';
import type { ChunkSpan, Draft, IndexedChild } from './ingestion.types.js';

type DraftChunk = ChunkSpan & { id: string; hash: string };

/**
 * The rows the index step inserts for a draft: documents, TOC nodes, parent and child
 * chunks, with ids and parent links already set (they're generated when the draft is built).
 */
export function indexRows(input: {
  sourceId: string;
  workspaceId: string;
  draft: Draft;
  // By child id.
  children: Map<string, IndexedChild>;
}) {
  const { sourceId, workspaceId, draft } = input;
  const documents = draft.documents.map((doc) => ({
    id: doc.id,
    sourceId,
    path: doc.path,
    language: doc.language,
    content: doc.content,
    pageStart: doc.pageStart,
    pageEnd: doc.pageEnd,
    lineCount: doc.lineCount,
    sizeBytes: doc.sizeBytes ?? Buffer.byteLength(doc.content),
    skippedReason: doc.skippedReason ?? null,
    hash: doc.hash,
  }));
  // In reading order, so a node's parent is always inserted before it.
  const tocNodes = draft.documents.flatMap((doc) =>
    doc.toc.map((entry, ordinal) => ({
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
  );
  const chunkFields = (doc: Draft['documents'][number], chunk: DraftChunk) => ({
    id: chunk.id,
    sourceId,
    documentId: doc.id,
    workspaceId,
    content: chunkText(doc.content, chunk.start, chunk.end),
    headingPath: chunk.headingPath,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    // Missing in drafts written before repositories were supported.
    lineStart: chunk.lineStart ?? null,
    lineEnd: chunk.lineEnd ?? null,
    symbolName: chunk.symbolName ?? null,
    tokenCount: chunk.tokenCount,
    hash: chunk.hash,
  });
  const parents = draft.documents.flatMap((doc) =>
    doc.parents.map((parent, ordinal) => ({
      ...chunkFields(doc, parent),
      kind: 'PARENT' as const,
      ordinal,
      searchText: '',
    })),
  );
  const children = draft.documents.flatMap((doc) =>
    doc.children.map((child, ordinal) => {
      const indexed = input.children.get(child.id)!;
      return {
        ...chunkFields(doc, child),
        parentId: doc.parents[child.parentIndex]!.id,
        kind: 'CHILD' as const,
        ordinal,
        context: indexed.context,
        searchText: indexed.searchText,
      };
    }),
  );

  return { documents, tocNodes, parents, children };
}
