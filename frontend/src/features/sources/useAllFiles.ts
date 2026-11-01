import { useEffect, useMemo } from 'react';
import { flatItems } from '@/api/queries/keys';
import { useSourceFiles } from '@/api/queries/sources';

// The files endpoint is flat and paged by 100. Repos are capped well below this many pages.
const MAX_PAGES = 30;

/** Every file of a repository: pages are fetched back to back until the list is complete. */
export function useAllFiles(sourceId: string) {
  const query = useSourceFiles(sourceId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, data } = query;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && (data?.pages.length ?? 0) < MAX_PAGES) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, data?.pages.length]);

  const files = useMemo(() => flatItems(data), [data]);
  return { ...query, files };
}
