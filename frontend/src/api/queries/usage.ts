import { queryOptions, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../client';
import { keys } from './keys';

export const usageQueryOptions = queryOptions({
  queryKey: keys.usage,
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/usage/me', { signal })),
  staleTime: 60_000,
});

export function useUsage() {
  return useQuery(usageQueryOptions);
}
