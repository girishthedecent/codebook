import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, isApiError, unwrap } from '../client';
import type { CreateStudyBody, Page, Study, StudyDetail, StudyType } from '../types';
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

export function useCancelStudy(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    // Finished or deleted in the meantime: there is nothing left to stop, the refresh
    // below shows how it ended.
    mutationFn: (studyId: string) =>
      unwrap(api.POST('/api/v1/study/{studyId}/cancel', { params: { path: { studyId } } })).catch(
        (e: unknown) => {
          if (!isApiError(e, 404) && !isApiError(e, 409)) throw e;
        },
      ),
    onSettled: (_data, _error, studyId) => {
      void client.invalidateQueries({ queryKey: keys.study(studyId) });
      void client.invalidateQueries({ queryKey: ['studies', workspaceId] });
    },
  });
}

export function useDeleteStudy(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    // Already gone (deleted in another tab) is the outcome the user asked for.
    mutationFn: (studyId: string) =>
      unwrap(api.DELETE('/api/v1/study/{studyId}', { params: { path: { studyId } } })).catch(
        (e: unknown) => {
          if (!isApiError(e, 404)) throw e;
        },
      ),
    onSuccess: (_data, studyId) => {
      client.removeQueries({ queryKey: keys.study(studyId) });
      void client.invalidateQueries({ queryKey: ['studies', workspaceId] });
    },
  });
}

// Attempts: a quiz taken or a flashcard pass, kept per person and set. The generated client
// doesn't know these routes yet, so their shapes are written out here from the API contract.

export type AttemptItem = { index: number; ok: boolean };

export type StudyAttempt = {
  id: string;
  score: number;
  total: number;
  items: AttemptItem[];
  createdAt: string;
};

export type AttemptMark = { score: number; total: number; createdAt: string };

export type StudyAttemptFields = { lastAttempt: AttemptMark | null; attemptCount: number };

export type RecordAttemptBody = { score: number; total: number; items: AttemptItem[] };

/** The requester's last attempt and how many there are, on a set from the list or the detail. */
export function attemptsOf(study: Study | StudyDetail): StudyAttemptFields {
  const fields = study as Partial<StudyAttemptFields>;
  return { lastAttempt: fields.lastAttempt ?? null, attemptCount: fields.attemptCount ?? 0 };
}

const ATTEMPTS_SHOWN = 20;

// Under the set's own key, so whatever refreshes the set refreshes its attempts too.
const attemptsKey = (studyId: string) => [...keys.study(studyId), 'attempts'] as const;

/** The same envelope and errors as the generated client, for the attempts routes. */
function attemptsRequest<T>(studyId: string, init: RequestInit = {}, query = '') {
  return unwrap<T>(
    fetch(`/api/v1/study/${encodeURIComponent(studyId)}/attempts${query}`, {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', ...init.headers },
    }).then(async (response) => {
      const body: unknown = await response.json().catch(() => undefined);
      return response.ok
        ? { data: body as { data: T }, response }
        : { error: body ?? {}, response };
    }),
  );
}

/** The requester's recent attempts at a set, newest first. */
export function useStudyAttempts(studyId: string, enabled = true) {
  return useQuery({
    queryKey: attemptsKey(studyId),
    queryFn: ({ signal }) =>
      attemptsRequest<StudyAttempt[] | Page<StudyAttempt>>(
        studyId,
        { signal },
        `?limit=${ATTEMPTS_SHOWN}`,
      ),
    // The contract fixes the fields and the order but not the envelope; take either.
    select: (data) => (Array.isArray(data) ? data : data.items),
    enabled,
  });
}

/** Saves an attempt; the set and the list then show the new last score. */
export function useRecordAttempt(workspaceId: string, studyId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordAttemptBody) =>
      attemptsRequest<StudyAttempt>(studyId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.study(studyId) });
      void client.invalidateQueries({ queryKey: ['studies', workspaceId] });
    },
  });
}
