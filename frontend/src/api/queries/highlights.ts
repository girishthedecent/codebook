import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { api, isApiError, unwrap } from '../client';
import type { CreateHighlightBody, Highlight, Page, UpdateHighlightBody } from '../types';

export const HIGHLIGHT_TEXT_MAX = 2_000;
export const HIGHLIGHT_NOTE_MAX = 1_000;

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
        api.GET('/api/v1/workspaces/{workspaceId}/highlights', {
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
        api.POST('/api/v1/workspaces/{workspaceId}/highlights', {
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
        api.PATCH('/api/v1/highlights/{highlightId}', {
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
          api.DELETE('/api/v1/highlights/{highlightId}', {
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
