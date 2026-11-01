import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { queryOptions } from '@tanstack/react-query';

// pdf.js parses in its own worker; the main thread only draws.
GlobalWorkerOptions.workerSrc = workerUrl;

/** The file could not be had; `status` is the HTTP status when there was a response. */
export class NoPdfError extends Error {
  constructor(readonly status: number) {
    super('The original file is not available');
  }
}

/**
 * Whether the reader should be shown the page's text instead: the file is refused to this
 * visitor or isn't there. Anything else (a dropped connection, a server error) is worth a retry.
 */
export function readAsText(error: unknown) {
  return error instanceof NoPdfError && [401, 403, 404].includes(error.status);
}

/**
 * The original PDF, streamed with Range requests so opening page 400 doesn't download the
 * whole book. Whoever isn't allowed the file gets a 404 and reads the text instead.
 */
export const pdfDocumentOptions = (sourceId: string) =>
  queryOptions({
    queryKey: ['source', sourceId, 'pdf'] as const,
    queryFn: async (): Promise<PDFDocumentProxy> => {
      const task = getDocument({
        url: `/api/v1/sources/${sourceId}/file`,
        withCredentials: true,
        rangeChunkSize: 256 * 1024,
        disableAutoFetch: true,
      });
      try {
        return await task.promise;
      } catch (error) {
        const { status, missing } = error as { status?: number; missing?: boolean };
        throw new NoPdfError(missing ? 404 : (status ?? 0));
      }
    },
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
    structuralSharing: false,
  });
