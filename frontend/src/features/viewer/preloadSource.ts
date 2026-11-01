import { queryClient } from '@/api/queryClient';
import { sourceContentQueryOptions, sourceQueryOptions } from '@/api/queries/sources';
import type { ViewerTarget } from '@/lib/viewerParams';

const WINDOW = 400;

/**
 * Warms what opening a citation will need, so the viewer is ready when it is clicked: its
 * code, the book's PDF and its worker, and the page text. Meant for hover and focus on a
 * citation. Safe to call often; it does nothing that is already cached and never throws.
 * This module stays small on purpose: the viewer and pdf.js are only imported when needed.
 */
export function preloadSource(target: ViewerTarget): void {
  void import('./ViewerPane').catch(() => undefined);
  void queryClient.prefetchQuery(sourceQueryOptions(target.sourceId));

  if (target.kind === 'page') {
    void import('./pdf')
      .then(({ pdfDocumentOptions }) =>
        queryClient.prefetchQuery(pdfDocumentOptions(target.sourceId)),
      )
      .catch(() => undefined);
    return;
  }

  // The window the viewer will ask for first: the one holding the cited line.
  const line = target.lineStart ?? 1;
  const start = Math.floor((line - 1) / WINDOW) * WINDOW + 1;
  void queryClient.prefetchQuery(
    sourceContentQueryOptions(target.sourceId, {
      path: target.path,
      lineStart: start,
      lineEnd: start + WINDOW - 1,
    }),
  );
}
