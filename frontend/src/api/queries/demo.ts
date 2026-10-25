import { queryOptions, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../client';
import { keys } from './keys';

/** The public demo workspace and its sources; no session needed. */
export const demoQueryOptions = queryOptions({
  queryKey: keys.demo,
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/demo', { signal })),
  staleTime: 10 * 60_000,
});

export function useDemo() {
  return useQuery(demoQueryOptions);
}
