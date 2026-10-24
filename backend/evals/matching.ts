import { normalizeUrl } from '../src/modules/ingestion/web/crawler.js';
import type { ExpectedRef } from './dataset.js';

// When a retrieved chunk counts as finding an expected ref (PLAN 10.4).

export type MatchableChunk = {
  // From the corpus sources; null for a chunk from a source outside the corpus.
  sourceKey: string | null;
  documentPath: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
};

// Both ranges are inclusive, so ranges that share an end page or line overlap.
function overlaps(start: number | null, end: number | null, refStart: number, refEnd: number) {
  if (start === null) return false;
  return start <= refEnd && refStart <= (end ?? start);
}

/** The crawler's URL form, without a trailing slash: `/guide/` and `/guide` are one page. */
export function comparableUrl(raw: string) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

const comparablePath = (path: string) => path.replace(/^\.?\/+/, '');
const comparableHeading = (heading: string) => heading.trim().toLowerCase();

export function hitsRef(chunk: MatchableChunk, ref: ExpectedRef) {
  if (chunk.sourceKey !== ref.sourceKey) return false;

  switch (ref.sourceKey) {
    case 'book':
      return overlaps(chunk.pageStart, chunk.pageEnd, ref.pageStart, ref.pageEnd);
    case 'repo':
      return (
        comparablePath(chunk.documentPath) === comparablePath(ref.path) &&
        overlaps(chunk.lineStart, chunk.lineEnd, ref.lineStart, ref.lineEnd)
      );
    case 'docs': {
      const url = comparableUrl(ref.url);
      if (!url || comparableUrl(chunk.documentPath) !== url) return false;
      if (!ref.heading) return true;
      const heading = comparableHeading(ref.heading);
      return chunk.headingPath.some((item) => comparableHeading(item) === heading);
    }
  }
}

/** For each ranked chunk, the indexes of the expected refs it hits. */
export function refHits(ranked: MatchableChunk[], refs: ExpectedRef[]) {
  return ranked.map((chunk) => refs.flatMap((ref, index) => (hitsRef(chunk, ref) ? [index] : [])));
}
