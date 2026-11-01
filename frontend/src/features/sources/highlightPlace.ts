import type { Highlight } from '@/api/queries/highlights';
import type { ViewerTarget } from '@/lib/viewerParams';
import { hostOf } from './sourceMeta';

/** Where a highlight opens in the viewer. */
export function highlightTarget(h: Highlight): ViewerTarget {
  if (h.page !== null) return { kind: 'page', sourceId: h.sourceId, page: h.page };
  return {
    kind: 'file',
    sourceId: h.sourceId,
    path: h.path ?? '',
    lineStart: h.lineStart ?? undefined,
    lineEnd: h.lineEnd ?? undefined,
    heading: h.heading ?? undefined,
  };
}

/** "p. 42", "model.py, lines 42–61", "Decoding strategies". Code paths are set in mono. */
export function highlightPlace(h: Highlight): { text: string; mono: boolean } {
  if (h.page !== null) return { text: `p. ${h.page}`, mono: false };
  if (h.sourceType === 'GITHUB_REPO' && h.path) {
    if (h.lineStart === null) return { text: h.path, mono: true };
    const end = h.lineEnd ?? h.lineStart;
    const lines = end === h.lineStart ? `line ${h.lineStart}` : `lines ${h.lineStart}–${end}`;
    return { text: `${h.path}, ${lines}`, mono: true };
  }
  return { text: h.heading ?? hostOf(h.path ?? ''), mono: false };
}
