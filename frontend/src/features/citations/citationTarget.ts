import type { Citation } from '@/api/types';
import type { ViewerTarget } from '@/lib/viewerParams';

/** Where a citation opens: a viewer target, an outside link (web results), or nowhere. */
export type CitationDestination =
  { kind: 'viewer'; target: ViewerTarget } | { kind: 'external'; url: string } | { kind: 'none' };

export function citationDestination(c: Citation): CitationDestination {
  if (!c.valid) return { kind: 'none' };
  if (c.kind === 'WEB') return c.url ? { kind: 'external', url: c.url } : { kind: 'none' };
  if (!c.sourceId) return { kind: 'none' };
  if (c.pageStart)
    return { kind: 'viewer', target: { kind: 'page', sourceId: c.sourceId, page: c.pageStart } };
  if (c.path) {
    return {
      kind: 'viewer',
      target: {
        kind: 'file',
        sourceId: c.sourceId,
        path: c.path,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        heading: c.heading,
      },
    };
  }
  return { kind: 'none' };
}

/** "DDIA · p. 157", "lib/router/index.js:42–61", "expressjs.com · Routing". */
export function citationLabel(c: Citation): string {
  if (c.pageStart) {
    const pages =
      c.pageEnd && c.pageEnd !== c.pageStart
        ? `pp. ${c.pageStart}–${c.pageEnd}`
        : `p. ${c.pageStart}`;
    return `${c.sourceTitle} · ${pages}`;
  }
  if (c.path && c.lineStart) {
    const lines =
      c.lineEnd && c.lineEnd !== c.lineStart ? `${c.lineStart}–${c.lineEnd}` : `${c.lineStart}`;
    return `${c.path}:${lines}`;
  }
  if (c.heading) return `${c.sourceTitle} · ${c.heading}`;
  if (c.kind === 'WEB' && c.url) return hostOf(c.url);
  return c.path ?? c.sourceTitle;
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
