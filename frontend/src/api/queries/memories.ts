import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../client';
import type { CreateMemoryBody, MemoriesQuery, UpdateMemoryBody } from '../types';
import { keys } from './keys';

export const memoriesQueryOptions = (query: MemoriesQuery = {}) =>
  queryOptions({
    queryKey: keys.memories(query),
    queryFn: ({ signal }) => unwrap(api.GET('/api/v1/memories', { params: { query }, signal })),
  });

export function useMemories(query?: MemoriesQuery) {
  return useQuery(memoriesQueryOptions(query));
}

function useInvalidateMemories() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['memories'] });
}

export function useCreateMemory() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: (body: CreateMemoryBody) => unwrap(api.POST('/api/v1/memories', { body })),
    onSuccess: invalidate,
  });
}

export function useUpdateMemory() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: ({ memoryId, ...body }: { memoryId: string } & UpdateMemoryBody) =>
      unwrap(api.PATCH('/api/v1/memories/{memoryId}', { params: { path: { memoryId } }, body })),
    onSuccess: invalidate,
  });
}

/** Soft delete; `useRestoreMemory` brings it back (the "undo"). */
export function useDeleteMemory() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: (memoryId: string) =>
      unwrap(api.DELETE('/api/v1/memories/{memoryId}', { params: { path: { memoryId } } })),
    onSuccess: invalidate,
  });
}

export function useRestoreMemory() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: (memoryId: string) =>
      unwrap(api.POST('/api/v1/memories/{memoryId}/restore', { params: { path: { memoryId } } })),
    onSuccess: invalidate,
  });
}

export function useClearMemories() {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/v1/memories')),
    onSuccess: invalidate,
  });
}
