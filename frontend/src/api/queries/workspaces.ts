import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, unwrap } from '../client';
import type { CreateWorkspaceBody, UpdateWorkspaceBody } from '../types';
import { keys } from './keys';

export const workspacesQueryOptions = infiniteQueryOptions({
  queryKey: keys.workspaces,
  queryFn: ({ pageParam, signal }) =>
    unwrap(
      api.GET('/api/v1/workspaces', {
        params: { query: { cursor: pageParam, limit: 50 } },
        signal,
      }),
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});

export const workspaceQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: keys.workspace(workspaceId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}', { params: { path: { workspaceId } }, signal }),
      ),
  });

export function useWorkspaces() {
  return useInfiniteQuery(workspacesQueryOptions);
}

export function useWorkspace(workspaceId: string) {
  return useQuery(workspaceQueryOptions(workspaceId));
}

export function useCreateWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspaceBody) => unwrap(api.POST('/api/v1/workspaces', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useUpdateWorkspace(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWorkspaceBody) =>
      unwrap(
        api.PATCH('/api/v1/workspaces/{workspaceId}', { params: { path: { workspaceId } }, body }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.workspaces });
      void client.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
    },
  });
}

export function useDeleteWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      unwrap(api.DELETE('/api/v1/workspaces/{workspaceId}', { params: { path: { workspaceId } } })),
    onSuccess: (_data, workspaceId) => {
      client.removeQueries({ queryKey: keys.workspace(workspaceId) });
      void client.invalidateQueries({ queryKey: keys.workspaces });
    },
  });
}
