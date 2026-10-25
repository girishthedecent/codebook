import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  graphCallersQueryOptions,
  graphDependenciesQueryOptions,
  graphSymbolsQueryOptions,
} from '@/api/queries';
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

/** Up to 100 symbols matching a name or path fragment. */
export function useSymbolMatches(repo: string, q: string) {
  return useQuery(graphSymbolsQueryOptions(repo, q, 100));
}

/**
 * A symbol by id. There is no lookup route, so this reads the `symbol` field of a depth-1
 * callers walk, which is cheap and shares the cache with the views that need it anyway.
 */
export function useSymbolById(repo: string, id: string | undefined) {
  return useQuery({
    ...graphCallersQueryOptions(repo, id ?? '', 1),
    enabled: Boolean(id),
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

/** Navigation helpers shared by the canvas, the tree and the lists. */
export function useGraphNavigation(repo: string) {
  const navigate = graphRoute.useNavigate();
  return {
    /** Opens the code viewer at the symbol's lines; the graph stays as it is. */
    openInViewer: (s: Pick<GraphSymbol, 'filePath' | 'lineStart' | 'lineEnd'>) =>
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
    /** Puts the symbol in the middle of the graph. */
    focus: (id: string) =>
      navigate({ search: (prev) => ({ ...prev, symbol: id, mode: 'explore' }) }),
  };
}

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}
