import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { flatItems, keys } from '@/api/queries/keys';
import { sourcesQueryOptions } from '@/api/queries/sources';
import { isIndexing } from './sourceMeta';

const POLL_MS = 2500;

/**
 * The workspace's sources, refetched every few seconds while any of them is indexing. The
 * list is how every row learns its progress; only the detail page opens a stream (the
 * backend allows a handful per person).
 */
export function useSourceList(workspaceId: string) {
  const client = useQueryClient();
  const query = useInfiniteQuery({
    ...sourcesQueryOptions(workspaceId),
    refetchInterval: (q) =>
      flatItems(q.state.data).some((s) => isIndexing(s.status)) ? POLL_MS : false,
  });
  const sources = useMemo(() => flatItems(query.data), [query.data]);

  // A source that was indexing and no longer is changed more than its row: counts, graph.
  const running = useRef(new Set<string>());
  useEffect(() => {
    for (const id of [...running.current]) {
      const now = sources.find((s) => s.id === id);
      if (now && isIndexing(now.status)) continue;
      running.current.delete(id);
      void client.invalidateQueries({ queryKey: keys.source(id) });
      void client.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
    }
    for (const s of sources) if (isIndexing(s.status)) running.current.add(s.id);
  }, [sources, client, workspaceId]);

  return { ...query, sources };
}

/** The current time, refreshed every `ms` while `enabled`: for "no progress for 12 min". */
export function useNow(enabled: boolean, ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [enabled, ms]);
  return now;
}
