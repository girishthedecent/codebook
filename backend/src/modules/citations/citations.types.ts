import type { SourceType } from '../../generated/prisma/enums.js';

// What a citation number [n] points at. Chunks come from search; line and page ranges from
// read_source, search_code and the graph tools; web results from web_search.
export type CitationKind = 'CHUNK' | 'LINES' | 'PAGES' | 'WEB';

export type CitationRef = {
  n: number;
  kind: CitationKind;
  chunkId?: string;
  sourceId?: string;
  sourceTitle: string;
  sourceType?: SourceType;
  // File path, page-less document name, or the page URL for web sources.
  path?: string;
  heading?: string;
  pageStart?: number;
  pageEnd?: number;
  lineStart?: number;
  lineEnd?: number;
  url?: string;
  // The text the model was shown, kept for the support check and the snippet.
  text: string;
};

export type NewCitation = Omit<CitationRef, 'n'>;

/** A citation as it is saved and sent to the client, after the answer was checked. */
export type CheckedCitation = Omit<CitationRef, 'text'> & {
  valid: boolean;
  // Lexical support of the sentences that cite it: null when nothing cited it.
  supported: boolean | null;
  snippet: string;
};
