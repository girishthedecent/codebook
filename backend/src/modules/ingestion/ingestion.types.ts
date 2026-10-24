import type { GraphStats } from '../graph/resolve.js';

// What a source turns into before it is indexed. The prepare step builds it, the IngestDraft
// row stores it between Inngest steps, and the index step writes it out as rows.
// Offsets are character positions in the document's `content`.

export type TocEntry = {
  title: string;
  number: string | null;
  // 1 = chapter (top level).
  level: number;
  // Index of the parent entry in the same list, or null at the top.
  parentIndex: number | null;
  charStart: number;
  charEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
};

export type ChunkSpan = {
  start: number;
  end: number;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  // Repository files only: 1-based, inclusive, as GitHub numbers them.
  lineStart: number | null;
  lineEnd: number | null;
  // The symbol a code chunk belongs to (`AuthService.login`), when it is one symbol or part of one.
  symbolName: string | null;
  tokenCount: number;
};

export type ChildSpan = ChunkSpan & {
  // Index into the document's parents.
  parentIndex: number;
};

export type ChunkPlan = {
  parents: ChunkSpan[];
  children: ChildSpan[];
};

export type DraftDocument = {
  id: string;
  path: string;
  language: string | null;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  lineCount: number | null;
  // Size of the original file; for a skipped file (no content) the only size there is.
  // Missing in drafts written before repositories: then the content's size.
  sizeBytes?: number;
  // Set for files left out of the index (no content, no chunks), e.g. "secret file".
  skippedReason?: string | null;
  // Repository files: imports and top-level names, shown to the contextualize model.
  outline?: string;
  hash: string;
  toc: (TocEntry & { id: string })[];
  parents: (ChunkSpan & { id: string; hash: string })[];
  children: (ChildSpan & { id: string; hash: string })[];
};

// What the index step can't recount from the documents.
export type RepoDraftStats = {
  commitSha: string;
  files: number;
  skippedFiles: number;
  redactions: number;
  languages: Record<string, number>;
  // Symbol and edge counts with resolution rates (modules/graph). Missing before the graph.
  graph?: GraphStats;
};

export type WebsiteDraftStats = {
  pages: number;
  // Linked pages that were tried but not kept (not HTML, too big, an error).
  skippedPages: number;
  robotsBlocked: number;
};

export type Draft = {
  // Missing in drafts written before repositories were supported: those are PDFs.
  sourceType?: 'PDF' | 'GITHUB_REPO' | 'WEBSITE';
  repo?: RepoDraftStats;
  website?: WebsiteDraftStats;
  // Snapshot of the source title: it feeds prompts, cache keys and embedding inputs, so
  // every step must use the same one even if the source is renamed mid-run.
  title: string;
  // Owner and workspace, for usage records and the chunks' workspaceId.
  userId: string;
  workspaceId: string;
  contentHash: string;
  documents: DraftDocument[];
};

// A repository's code graph (modules/graph). Stored next to the draft, not in it: only the
// index step needs it, and the other steps load the draft every time.
export type DraftSymbol = {
  id: string;
  documentId: string;
  name: string;
  qualifiedName: string;
  kind: 'FILE' | 'CLASS' | 'INTERFACE' | 'FUNCTION' | 'METHOD';
  filePath: string;
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  exported: boolean;
  chunkId: string | null;
};

export type DraftEdge = {
  fromSymbolId: string;
  toSymbolId: string | null;
  toName: string;
  type: 'IMPORTS' | 'DEFINES' | 'EXTENDS' | 'IMPLEMENTS' | 'CALLS';
  filePath: string;
  line: number;
};

export type DraftGraph = { symbols: DraftSymbol[]; edges: DraftEdge[] };

// What search indexes for a child, built in the embed and index steps.
export type IndexedChild = {
  context: string | null;
  searchText: string;
  // EmbeddingCache key of the child's vector, which the transaction copies in SQL.
  embeddingKey: string;
};
