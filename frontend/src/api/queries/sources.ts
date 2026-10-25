import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, api, unwrap, type ErrorBody } from '../client';
import type { ContentQuery, CreateSourceBody, SearchBody, Source } from '../types';
import { keys } from './keys';

export const sourcesQueryOptions = (workspaceId: string) =>
  infiniteQueryOptions({
    queryKey: keys.sources(workspaceId),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/sources', {
          params: { path: { workspaceId }, query: { cursor: pageParam, limit: 100 } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const sourceQueryOptions = (sourceId: string) =>
  queryOptions({
    queryKey: keys.source(sourceId),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/sources/{sourceId}', { params: { path: { sourceId } }, signal })),
  });

export const sourceFilesQueryOptions = (sourceId: string, prefix?: string) =>
  infiniteQueryOptions({
    queryKey: keys.sourceFiles(sourceId, prefix),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/api/v1/sources/{sourceId}/files', {
          params: { path: { sourceId }, query: { cursor: pageParam, limit: 100, prefix } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const sourceTocQueryOptions = (sourceId: string) =>
  queryOptions({
    queryKey: keys.sourceToc(sourceId),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/sources/{sourceId}/toc', { params: { path: { sourceId } }, signal })),
    staleTime: Infinity,
  });

/** A page, a TOC section or a line range; see ContentQuery for which fields pick which. */
export const sourceContentQueryOptions = (sourceId: string, query: ContentQuery) =>
  queryOptions({
    queryKey: keys.sourceContent(sourceId, query),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/sources/{sourceId}/content', {
          params: { path: { sourceId }, query },
          signal,
        }),
      ),
    staleTime: Infinity,
  });

export const graphSymbolsQueryOptions = (sourceId: string, q: string, limit = 20) =>
  queryOptions({
    queryKey: keys.graph(sourceId, 'symbols', { q, limit }),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/sources/{sourceId}/graph/symbols', {
          params: { path: { sourceId }, query: { q, limit } },
          signal,
        }),
      ),
    enabled: q.trim().length > 0,
  });

export const graphCallersQueryOptions = (sourceId: string, symbol: string, depth = 2) =>
  queryOptions({
    queryKey: keys.graph(sourceId, 'callers', { symbol, depth }),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/sources/{sourceId}/graph/callers', {
          params: { path: { sourceId }, query: { symbol, depth } },
          signal,
        }),
      ),
  });

export const graphDependenciesQueryOptions = (sourceId: string, symbol: string, depth = 2) =>
  queryOptions({
    queryKey: keys.graph(sourceId, 'dependencies', { symbol, depth }),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/sources/{sourceId}/graph/dependencies', {
          params: { path: { sourceId }, query: { symbol, depth } },
          signal,
        }),
      ),
  });

export const graphPathQueryOptions = (
  sourceId: string,
  from: string,
  to: string,
  imports = false,
) =>
  queryOptions({
    queryKey: keys.graph(sourceId, 'path', { from, to, imports }),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/sources/{sourceId}/graph/path', {
          // The backend coerces this flag from a string.
          params: {
            path: { sourceId },
            query: { from, to, imports: imports ? 'true' : undefined },
          },
          signal,
        }),
      ),
  });

/** Debug retrieval: the same search the agent runs, with scores. */
export const searchQueryOptions = (workspaceId: string, body: SearchBody) =>
  queryOptions({
    queryKey: keys.search(workspaceId, body),
    queryFn: ({ signal }) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspaceId}/search', {
          params: { path: { workspaceId } },
          body,
          signal,
        }),
      ),
    enabled: body.query.trim().length > 0,
    staleTime: 60_000,
  });

export function useSources(workspaceId: string) {
  return useInfiniteQuery(sourcesQueryOptions(workspaceId));
}
export function useSource(sourceId: string) {
  return useQuery(sourceQueryOptions(sourceId));
}
export function useSourceFiles(sourceId: string, prefix?: string) {
  return useInfiniteQuery(sourceFilesQueryOptions(sourceId, prefix));
}
export function useSourceToc(sourceId: string) {
  return useQuery(sourceTocQueryOptions(sourceId));
}
export function useSourceContent(sourceId: string, query: ContentQuery, enabled = true) {
  return useQuery({ ...sourceContentQueryOptions(sourceId, query), enabled });
}
export function useGraphSymbols(sourceId: string, q: string) {
  return useQuery(graphSymbolsQueryOptions(sourceId, q));
}
export function useGraphCallers(sourceId: string, symbol: string, depth?: number) {
  return useQuery(graphCallersQueryOptions(sourceId, symbol, depth));
}
export function useGraphDependencies(sourceId: string, symbol: string, depth?: number) {
  return useQuery(graphDependenciesQueryOptions(sourceId, symbol, depth));
}
export function useGraphPath(sourceId: string, from: string, to: string, imports?: boolean) {
  return useQuery(graphPathQueryOptions(sourceId, from, to, imports));
}
export function useSearch(workspaceId: string, body: SearchBody) {
  return useQuery(searchQueryOptions(workspaceId, body));
}

/** Adds a GitHub repo or a website. PDFs go through `uploadPdf`. */
export function useCreateSource(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSourceBody) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspaceId}/sources', {
          params: { path: { workspaceId } },
          body,
        }),
      ),
    onSuccess: () => invalidateSources(client, workspaceId),
  });
}

export type UploadOptions = {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export const PDF_MAX_BYTES = 50 * 1024 * 1024;

/** True when the file starts with the PDF header, so a wrong file is refused before upload. */
export async function looksLikePdf(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === '%PDF-';
}

/**
 * Multipart upload with progress. `fetch` can't report upload progress, so this is the one
 * place that still uses XMLHttpRequest. Resolves with the created source.
 */
export function uploadPdf(
  workspaceId: string,
  { file, title }: { file: File; title?: string },
  { onProgress, signal }: UploadOptions = {},
): Promise<Source> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set('type', 'PDF');
    if (title) form.set('title', title);
    form.set('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sources`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = xhr.response as { data: Source } | ErrorBody | null;
      if (xhr.status >= 200 && xhr.status < 300 && body && 'data' in body) {
        onProgress?.(1);
        resolve(body.data);
      } else {
        const retry = xhr.getResponseHeader('Retry-After');
        reject(
          new ApiError(
            xhr.status,
            (body as ErrorBody | null) ?? undefined,
            retry ? Number(retry) || undefined : undefined,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new ApiError(0, undefined));
    xhr.onabort = () => reject(new DOMException('The upload was cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(form);
  });
}

export function useUploadPdf(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; title?: string } & UploadOptions) =>
      uploadPdf(workspaceId, input, input),
    onSuccess: () => invalidateSources(client, workspaceId),
  });
}

export function useDeleteSource(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      unwrap(api.DELETE('/api/v1/sources/{sourceId}', { params: { path: { sourceId } } })),
    onSuccess: (_data, sourceId) => {
      client.removeQueries({ queryKey: keys.source(sourceId) });
      void invalidateSources(client, workspaceId);
    },
  });
}

export function useResyncSource(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      unwrap(api.POST('/api/v1/sources/{sourceId}/resync', { params: { path: { sourceId } } })),
    onSuccess: (source) => {
      client.setQueryData(keys.source(source.id), source);
      void invalidateSources(client, workspaceId);
    },
  });
}

function invalidateSources(client: ReturnType<typeof useQueryClient>, workspaceId: string) {
  void client.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
  return client.invalidateQueries({ queryKey: keys.sources(workspaceId) });
}

/** Writes a progress update into the cached source list and detail, so rows update live. */
export function patchSourceInCache(
  client: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  sourceId: string,
  patch: Partial<Pick<Source, 'status' | 'stage' | 'progress' | 'error'>>,
) {
  client.setQueryData(keys.source(sourceId), (old: Source | undefined) =>
    old ? { ...old, ...patch } : old,
  );
  client.setQueryData(
    keys.sources(workspaceId),
    (
      old:
        | { pages: { items: Source[]; nextCursor: string | null }[]; pageParams: unknown[] }
        | undefined,
    ) =>
      old && {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((s) => (s.id === sourceId ? { ...s, ...patch } : s)),
        })),
      },
  );
}
