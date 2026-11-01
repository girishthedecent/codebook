import { api, unwrap } from '@/api/client';

/** Whether this deployment has an eval worker; when it hasn't, starting a run answers 503. */
export const evalsStatusQuery = {
  queryKey: ['evals', 'status'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    unwrap(api.GET('/api/v1/evals/status', { signal })),
  staleTime: 5 * 60_000,
};
