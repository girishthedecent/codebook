import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { api, unwrap } from '../client';
import type { StatsQuery } from '../types';
import { keys } from './keys';

export const monitoringStatsQueryOptions = (query: StatsQuery = {}) =>
  queryOptions({
    queryKey: keys.monitoringStats(query),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/monitoring/stats', { params: { query }, signal })),
    staleTime: 60_000,
  });

export const failedQueriesQueryOptions = infiniteQueryOptions({
  queryKey: keys.failedQueries,
  queryFn: ({ pageParam, signal }) =>
    unwrap(
      api.GET('/api/v1/monitoring/failed-queries', {
        params: { query: { cursor: pageParam, limit: 50 } },
        signal,
      }),
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});

export function useMonitoringStats(query?: StatsQuery) {
  return useQuery(monitoringStatsQueryOptions(query));
}

export function useFailedQueries() {
  return useInfiniteQuery(failedQueriesQueryOptions);
}
