import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * The printed page labels of a book ("xii", "90") by physical page; empty when it has none.
 * The reader fills this in once the PDF is open, and the header reads it from the cache
 * without pulling pdf.js in.
 */
export const pageLabelsOptions = (sourceId: string, doc?: PDFDocumentProxy) =>
  queryOptions({
    queryKey: ['source', sourceId, 'pdf', 'labels'] as const,
    queryFn: doc ? () => doc.getPageLabels().then((labels) => labels ?? []) : skipToken,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });

/** The printed label of `page`, only when it differs from the physical number. */
export function usePrintedLabel(sourceId: string, page: number) {
  const { data } = useQuery(pageLabelsOptions(sourceId));
  const label = data?.[page - 1];
  return label && label !== String(page) ? label : undefined;
}
