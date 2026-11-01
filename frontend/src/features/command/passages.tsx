import { Fragment, type ReactNode } from 'react';
import type { SearchHit } from '@/api/types';
import type { ViewerTarget } from '@/lib/viewerParams';

/** Where in the viewer a search hit lives. */
export function hitTarget(hit: SearchHit): ViewerTarget {
  if (hit.pageStart) return { kind: 'page', sourceId: hit.sourceId, page: hit.pageStart };
  return {
    kind: 'file',
    sourceId: hit.sourceId,
    path: hit.documentPath,
    lineStart: hit.lineStart ?? undefined,
    lineEnd: hit.lineEnd ?? undefined,
    heading: hit.sourceType === 'WEBSITE' ? hit.headingPath.at(-1) : undefined,
  };
}

/** "p. 157", "lib/router.js:42–61", or the heading a passage sits under. */
export function hitWhere(hit: SearchHit): string {
  if (hit.pageStart) return `p. ${hit.pageStart}`;
  if (hit.lineStart) {
    const end = hit.lineEnd && hit.lineEnd !== hit.lineStart ? `–${hit.lineEnd}` : '';
    return `${hit.documentPath}:${hit.lineStart}${end}`;
  }
  return hit.headingPath.at(-1) ?? hit.documentPath;
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The words of a search worth marking in a result: two letters or more, each once. */
export function queryTerms(query: string) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 2),
    ),
  ];
}

/** The text with each of the query's words marked, the way a search page shows a match. */
export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const terms = queryTerms(query);
  if (terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escape).join('|')})`, 'gi');
  return text.split(pattern).map((part, i) =>
    // An odd index is a capture group, that is, a match.
    i % 2 === 1 ? (
      <mark key={i} className="rounded-xs bg-highlight px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** A window of the passage around the first match, so a long chunk shows the part that matched. */
export function snippetAround(text: string, query: string, length = 160) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= length) return flat;
  const first = queryTerms(query)
    .map((term) => flat.toLowerCase().indexOf(term))
    .filter((at) => at >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (first ?? 0) - 40);
  const cut = flat.slice(start, start + length);
  return `${start > 0 ? '…' : ''}${cut}${start + length < flat.length ? '…' : ''}`;
}
