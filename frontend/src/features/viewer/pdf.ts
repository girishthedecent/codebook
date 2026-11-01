import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { queryOptions } from '@tanstack/react-query';
import { queryClient } from '@/api/queryClient';
import { sourceQueryOptions } from '@/api/queries/sources';
import { originOf, type PdfOrigin } from '@/features/sources/sourceInfo';

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

// Below this a book is fetched in one go: one request beats dozens of small ranges, and every
// page after the first is already local. Larger files are read in ranges.
const WHOLE_FILE_BYTES = 15 * 1024 * 1024;

/** The stored size of the file, when the source says. Never throws; unknown means ranges. */
async function fileSize(sourceId: string) {
  try {
    const source = await queryClient.ensureQueryData({
      ...sourceQueryOptions(sourceId),
      retry: false,
    });
    const size = originOf<PdfOrigin>(source).size;
    return typeof size === 'number' ? size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The original PDF. A small file comes down whole; a large one is read with Range requests so
 * opening page 400 doesn't download the whole book. Whoever isn't allowed the file gets a 404
 * and reads the text instead.
 */
export const pdfDocumentOptions = (sourceId: string) =>
  queryOptions({
    queryKey: ['source', sourceId, 'pdf'] as const,
    queryFn: async (): Promise<PDFDocumentProxy> => {
      const size = await fileSize(sourceId);
      const whole = size !== undefined && size < WHOLE_FILE_BYTES;
      const task = getDocument({
        url: `/api/v1/sources/${sourceId}/file`,
        withCredentials: true,
        ...(whole
          ? { disableRange: true, disableStream: true }
          : { rangeChunkSize: 256 * 1024, disableAutoFetch: true }),
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
