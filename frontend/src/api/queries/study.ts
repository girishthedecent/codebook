import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, unwrap } from '../client';
import type { CreateStudyBody, Study, StudyType } from '../types';
import { keys } from './keys';

const POLL_MS = 3000;

export function isStudyPending(study: Pick<Study, 'status'>) {
  return study.status === 'PENDING' || study.status === 'RUNNING';
}

export const studiesQueryOptions = (workspaceId: string, type?: StudyType) =>
  infiniteQueryOptions({
    queryKey: keys.studies(workspaceId, type),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/study', {
          params: { path: { workspaceId }, query: { cursor: pageParam, limit: 50, type } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Generation runs in the background; poll while anything is still being made, then stop.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some(isStudyPending)) ? POLL_MS : false,
  });

export const studyQueryOptions = (studyId: string) =>
  queryOptions({
    queryKey: keys.study(studyId),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/study/{studyId}', { params: { path: { studyId } }, signal })),
    refetchInterval: (query) =>
      query.state.data && isStudyPending(query.state.data) ? POLL_MS : false,
  });

export function useStudies(workspaceId: string, type?: StudyType) {
  return useInfiniteQuery(studiesQueryOptions(workspaceId, type));
}

export function useStudy(studyId: string) {
  return useQuery(studyQueryOptions(studyId));
}

export function useCreateStudy(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStudyBody) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspaceId}/study', {
          params: { path: { workspaceId } },
          body,
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['studies', workspaceId] }),
  });
}

export function useRegenerateStudy(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (studyId: string) =>
      unwrap(api.POST('/api/v1/study/{studyId}/regenerate', { params: { path: { studyId } } })),
    onSuccess: (study) => {
      void client.invalidateQueries({ queryKey: keys.study(study.id) });
      void client.invalidateQueries({ queryKey: ['studies', workspaceId] });
    },
  });
}

export function useDeleteStudy(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (studyId: string) =>
      unwrap(api.DELETE('/api/v1/study/{studyId}', { params: { path: { studyId } } })),
    onSuccess: (_data, studyId) => {
      client.removeQueries({ queryKey: keys.study(studyId) });
      void client.invalidateQueries({ queryKey: ['studies', workspaceId] });
    },
  });
}
