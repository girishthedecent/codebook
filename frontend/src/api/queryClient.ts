import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Client errors won't fix themselves; network blips and 5xx get two more tries.
      retry: (count, error) =>
        count < 2 && !(isApiError(error) && error.status >= 400 && error.status < 500),
    },
    mutations: { retry: 0 },
  },
});
