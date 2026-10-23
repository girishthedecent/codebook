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
  hash: string;
  toc: (TocEntry & { id: string })[];
  parents: (ChunkSpan & { id: string; hash: string })[];
  children: (ChildSpan & { id: string; hash: string })[];
};

export type Draft = {
  // Snapshot of the source title: it feeds prompts, cache keys and embedding inputs, so
  // every step must use the same one even if the source is renamed mid-run.
  title: string;
  // Owner and workspace, for usage records and the chunks' workspaceId.
  userId: string;
  workspaceId: string;
  contentHash: string;
  documents: DraftDocument[];
};
