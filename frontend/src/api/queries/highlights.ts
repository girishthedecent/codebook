import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { Client } from 'openapi-fetch';
import { api, isApiError, unwrap, type ErrorBody } from '../client';
import type { Page, SourceType } from '../types';

/** A passage someone marked while reading. Exactly one of `page` and `path` is set. */
export type Highlight = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: SourceType;
  page: number | null;
  path: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  heading: string | null;
  text: string;
  note: string | null;
  createdAt: string;
};

export type CreateHighlightBody = {
  sourceId: string;
  page?: number;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  heading?: string;
  text: string;
  note?: string;
};

export type UpdateHighlightBody = { note: string | null };

export const HIGHLIGHT_TEXT_MAX = 2_000;
export const HIGHLIGHT_NOTE_MAX = 1_000;

// The highlight routes, written out in the shape the schema generator gives every other route,
// so the calls below read like the rest of the API layer.
type Json<T> = { headers: { [name: string]: unknown }; content: { 'application/json': T } };
type Ok<T> = Json<{ data: T; message: string; success: true }>;
type NoParams = { query?: never; header?: never; path?: never; cookie?: never };
type HighlightPath = {
  query?: never;
  header?: never;
  path: { highlightId: string };
  cookie?: never;
};

type HighlightPaths = {
  '/api/v1/workspaces/{workspaceId}/highlights': {
    parameters: NoParams;
    get: {
      parameters: {
        query?: { sourceId?: string; cursor?: string; limit?: number };
        header?: never;
        path: { workspaceId: string };
        cookie?: never;
      };
      requestBody?: never;
      responses: { 200: Ok<Page<Highlight>>; 403: Json<ErrorBody>; 404: Json<ErrorBody> };
    };
    post: {
      parameters: { query?: never; header?: never; path: { workspaceId: string }; cookie?: never };
      requestBody: { content: { 'application/json': CreateHighlightBody } };
      responses: { 201: Ok<Highlight>; 403: Json<ErrorBody>; 409: Json<ErrorBody> };
    };
  };
  '/api/v1/highlights/{highlightId}': {
    parameters: NoParams;
    patch: {
      parameters: HighlightPath;
      requestBody: { content: { 'application/json': UpdateHighlightBody } };
      responses: { 200: Ok<Highlight>; 404: Json<ErrorBody> };
    };
    delete: {
      parameters: HighlightPath;
      requestBody?: never;
      responses: { 204: { headers: { [name: string]: unknown }; content?: never } };
    };
  };
};

const client = api as unknown as Client<HighlightPaths>;

export const highlightKeys = {
  all: (workspaceId: string) => ['highlights', workspaceId] as const,
  list: (workspaceId: string, sourceId?: string) =>
    ['highlights', workspaceId, sourceId ?? ''] as const,
};

/** Newest first; pass `sourceId` for one source's highlights. */
export const highlightsQueryOptions = (workspaceId: string, sourceId?: string) =>
  infiniteQueryOptions({
    queryKey: highlightKeys.list(workspaceId, sourceId),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        client.GET('/api/v1/workspaces/{workspaceId}/highlights', {
          params: { path: { workspaceId }, query: { sourceId, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export function useHighlights(workspaceId: string, sourceId?: string, enabled = true) {
  return useInfiniteQuery({ ...highlightsQueryOptions(workspaceId, sourceId), enabled });
}

type Lists = InfiniteData<Page<Highlight>, string | undefined>;

/** Applies a change to every cached list of the workspace, so each page updates at once. */
function patchLists(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  change: (items: Highlight[]) => Highlight[],
) {
  queryClient.setQueriesData<Lists>({ queryKey: highlightKeys.all(workspaceId) }, (old) =>
    old
      ? { ...old, pages: old.pages.map((page) => ({ ...page, items: change(page.items) })) }
      : old,
  );
}

export function useCreateHighlight(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHighlightBody) =>
      unwrap(
        client.POST('/api/v1/workspaces/{workspaceId}/highlights', {
          params: { path: { workspaceId } },
          body,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: highlightKeys.all(workspaceId) }),
  });
}

export function useUpdateHighlight(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ highlightId, note }: { highlightId: string } & UpdateHighlightBody) =>
      unwrap(
        client.PATCH('/api/v1/highlights/{highlightId}', {
          params: { path: { highlightId } },
          body: { note },
        }),
      ),
    onSuccess: (saved) => {
      patchLists(queryClient, workspaceId, (items) =>
        items.map((h) => (h.id === saved.id ? { ...h, note: saved.note } : h)),
      );
    },
  });
}

export function useDeleteHighlight(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (highlightId: string) => {
      try {
        await unwrap(
          client.DELETE('/api/v1/highlights/{highlightId}', {
            params: { path: { highlightId } },
          }),
        );
      } catch (error) {
        // Already gone is what was asked for.
        if (!isApiError(error, 404)) throw error;
      }
    },
    onSuccess: (_data, highlightId) => {
      patchLists(queryClient, workspaceId, (items) => items.filter((h) => h.id !== highlightId));
      void queryClient.invalidateQueries({ queryKey: highlightKeys.all(workspaceId) });
    },
  });
}
