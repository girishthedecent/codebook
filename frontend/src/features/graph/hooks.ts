import { useEffect, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  graphCallersQueryOptions,
  graphDependenciesQueryOptions,
  graphSymbolsQueryOptions,
} from '@/api/queries';
import { keys } from '@/api/queries/keys';
import { api, unwrap } from '@/api/client';
import { viewerSearchFor } from '@/lib/viewerParams';
import { graphRoute, type Direction } from './search';
import type { GraphSymbol } from '@/api/types';

export function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Where to start in a repository: its busiest symbols, files and most-called packages. */
export const graphOverviewQueryOptions = (sourceId: string) =>
  queryOptions({
    queryKey: keys.graph(sourceId, 'overview', {}),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/sources/{sourceId}/graph/overview', {
          params: { path: { sourceId } },
          signal,
        }),
      ),
    staleTime: 5 * 60_000,
  });

export function useOverview(repo: string) {
  return useQuery(graphOverviewQueryOptions(repo));
}

/** Up to 100 symbols matching a name or path fragment. */
export function useSymbolMatches(repo: string, q: string) {
  return useQuery(graphSymbolsQueryOptions(repo, q, 100));
}

/**
 * A symbol by qualified name or id. There is no lookup route, so this reads the `symbol` field
 * of a depth-1 callers walk, which is cheap and shares the cache with the views that need it
 * anyway.
 */
export function useSymbolByRef(repo: string, ref: string | undefined) {
  return useQuery({
    ...graphCallersQueryOptions(repo, ref ?? '', 1),
    enabled: Boolean(ref),
    select: (walk) => walk.symbol,
  });
}

/** Callers and dependencies of one symbol, as far as the direction asks for. */
export function useNeighborhood(repo: string, symbol: string, dir: Direction, depth: number) {
  const callers = useQuery({
    ...graphCallersQueryOptions(repo, symbol, depth),
    enabled: dir !== 'dependencies',
  });
  const dependencies = useQuery({
    ...graphDependenciesQueryOptions(repo, symbol, depth),
    enabled: dir !== 'callers',
  });
  const active = [dir !== 'dependencies' && callers, dir !== 'callers' && dependencies].filter(
    (q) => q !== false,
  );
  return {
    callers: dir !== 'dependencies' ? callers.data : undefined,
    dependencies: dir !== 'callers' ? dependencies.data : undefined,
    center: callers.data?.symbol ?? dependencies.data?.symbol,
    isPending: active.some((q) => q.isPending),
    error: active.find((q) => q.error)?.error ?? null,
    refetch: () => active.forEach((q) => void q.refetch()),
  };
}

type Placed = Pick<GraphSymbol, 'filePath' | 'lineStart' | 'lineEnd'>;

/** Navigation helpers shared by the map, the lists and the overview. */
export function useGraphNavigation(repo: string) {
  const navigate = graphRoute.useNavigate();
  return {
    /** Opens the code viewer at the symbol's lines; the graph stays as it is. */
    openInViewer: (s: Placed) =>
      navigate({
        search: (prev) => ({
          ...prev,
          ...viewerSearchFor({
            kind: 'file',
            sourceId: repo,
            path: s.filePath,
            lineStart: s.lineStart,
            lineEnd: s.lineEnd,
          }),
        }),
      }),
    /** Puts the symbol at the centre of the graph. */
    focus: (s: Pick<GraphSymbol, 'qualifiedName'>) =>
      navigate({ search: (prev) => ({ ...prev, symbol: s.qualifiedName, mode: 'explore' }) }),
    traceFrom: (s: Pick<GraphSymbol, 'qualifiedName'>) =>
      navigate({ search: (prev) => ({ ...prev, mode: 'trace', fromSym: s.qualifiedName }) }),
    traceTo: (s: Pick<GraphSymbol, 'qualifiedName'>) =>
      navigate({ search: (prev) => ({ ...prev, mode: 'trace', toSym: s.qualifiedName }) }),
  };
}

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}
