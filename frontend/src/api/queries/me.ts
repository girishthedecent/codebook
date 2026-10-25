import { queryOptions, useQuery } from '@tanstack/react-query';
import { api, isApiError, unwrap } from '../client';
import type { Me } from '../types';
import { keys } from './keys';

/** The signed-in user, or null when there is no session (a 401 is not an error here). */
export const meQueryOptions = queryOptions({
  queryKey: keys.me,
  queryFn: async ({ signal }): Promise<Me | null> => {
    try {
      return (await unwrap(api.GET('/api/v1/me', { signal }))) as Me;
    } catch (error) {
      if (isApiError(error, 401)) return null;
      throw error;
    }
  },
  staleTime: 5 * 60_000,
  retry: false,
});

export function useMeQuery() {
  return useQuery(meQueryOptions);
}
