import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../client';
import type { EvalResultsQuery, EvalRunsQuery, StartEvalRunBody } from '../types';
import { keys } from './keys';

export const evalDatasetsQueryOptions = queryOptions({
  queryKey: keys.evalDatasets,
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/evals/datasets', { signal })),
});

export const evalRunsQueryOptions = (query: EvalRunsQuery = {}) =>
  queryOptions({
    queryKey: keys.evalRuns(query),
    queryFn: ({ signal }) => unwrap(api.GET('/api/v1/evals/runs', { params: { query }, signal })),
    // A queued run shows up as RUNNING; keep the table fresh while one is going.
    refetchInterval: (q) =>
      q.state.data?.some((run) => run.status === 'RUNNING') ? 10_000 : false,
  });

export const evalRunQueryOptions = (runId: string) =>
  queryOptions({
    queryKey: keys.evalRun(runId),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/evals/runs/{runId}', { params: { path: { runId } }, signal })),
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 10_000 : false),
  });

export const evalResultsQueryOptions = (runId: string, query: EvalResultsQuery = {}) =>
  queryOptions({
    queryKey: keys.evalResults(runId, query),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/evals/runs/{runId}/results', {
          params: { path: { runId }, query },
          signal,
        }),
      ),
  });

export const evalCompareQueryOptions = (runs: string[]) =>
  queryOptions({
    queryKey: keys.evalCompare(runs),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/evals/compare', { params: { query: { runs: runs.join(',') } }, signal }),
      ),
    enabled: runs.length === 2,
  });

export function useEvalDatasets() {
  return useQuery(evalDatasetsQueryOptions);
}
export function useEvalRuns(query?: EvalRunsQuery) {
  return useQuery(evalRunsQueryOptions(query));
}
export function useEvalRun(runId: string) {
  return useQuery(evalRunQueryOptions(runId));
}
export function useEvalResults(runId: string, query?: EvalResultsQuery) {
  return useQuery(evalResultsQueryOptions(runId, query));
}
export function useEvalCompare(runs: string[]) {
  return useQuery(evalCompareQueryOptions(runs));
}

export function useStartEvalRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: StartEvalRunBody) => unwrap(api.POST('/api/v1/evals/runs', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['evals', 'runs'] }),
  });
}
