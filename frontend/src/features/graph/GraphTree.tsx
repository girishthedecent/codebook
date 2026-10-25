import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { graphCallersQueryOptions, graphDependenciesQueryOptions } from '@/api/queries';
import type { GraphSymbol } from '@/api/types';
import { Spinner } from '@/ui';
import { cn } from '@/lib/cn';
import { ErrorLine } from './ErrorLine';
import { SymbolLine } from './SymbolLine';
import { graphStrings as t } from './strings';

type Dir = 'callers' | 'dependencies';

type Props = {
  repo: string;
  center: GraphSymbol;
  /** Which sides to show; both by default. */
  dir?: 'callers' | 'dependencies' | 'both';
  onOpen: (symbol: GraphSymbol) => void;
  onFocus: (id: string) => void;
};

/**
 * The graph as a tree, one hop at a time: used on phones instead of the canvas, and as the
 * keyboard-friendly list view elsewhere. Each row fetches its own next level when expanded.
 */
export function GraphTree({ repo, center, dir = 'both', onOpen, onFocus }: Props) {
  return (
    <div className="space-y-6">
      {dir !== 'dependencies' && (
        <section aria-labelledby="tree-callers">
          <h2 id="tree-callers" className="mb-1 text-xs font-medium text-ink-2">
            {t.calledBy}
          </h2>
          <Level
            repo={repo}
            symbolId={center.id}
            dir="callers"
            ancestors={[center.id]}
            onOpen={onOpen}
            onFocus={onFocus}
          />
        </section>
      )}
      {dir !== 'callers' && (
        <section aria-labelledby="tree-calls">
          <h2 id="tree-calls" className="mb-1 text-xs font-medium text-ink-2">
            {t.calls}
          </h2>
          <Level
            repo={repo}
            symbolId={center.id}
            dir="dependencies"
            ancestors={[center.id]}
            onOpen={onOpen}
            onFocus={onFocus}
          />
        </section>
      )}
    </div>
  );
}

type LevelProps = {
  repo: string;
  symbolId: string;
  dir: Dir;
  ancestors: string[];
  onOpen: (symbol: GraphSymbol) => void;
  onFocus: (id: string) => void;
};

function Level({ repo, symbolId, dir, ancestors, onOpen, onFocus }: LevelProps) {
  // Two queries with one enabled: their result types differ, so they can't share a call.
  const callers = useQuery({
    ...graphCallersQueryOptions(repo, symbolId, 1),
    enabled: dir === 'callers',
  });
  const dependencies = useQuery({
    ...graphDependenciesQueryOptions(repo, symbolId, 1),
    enabled: dir === 'dependencies',
  });
  const query = dir === 'callers' ? callers : dependencies;

  if (query.isPending) {
    return (
      <div className="flex h-9 items-center gap-2 text-xs text-ink-3">
        <Spinner className="size-3.5" label={t.loading} />
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="py-2">
        <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const symbols = [...query.data.symbols].sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.lineStart - b.lineStart,
  );
  if (symbols.length === 0) {
    return (
      <p className="py-2 text-xs text-ink-3">
        {dir === 'callers' ? t.nothingCalls : t.callsNothing}
      </p>
    );
  }
  return (
    <ul role="group" className="border-l border-rule">
      {symbols.map((s) => (
        <Row
          key={s.id}
          repo={repo}
          symbol={s}
          dir={dir}
          ancestors={ancestors}
          onOpen={onOpen}
          onFocus={onFocus}
        />
      ))}
      {query.data.truncated && <li className="py-1.5 pl-3 text-xs text-ink-3">{t.truncated}</li>}
    </ul>
  );
}

function Row({
  repo,
  symbol,
  dir,
  ancestors,
  onOpen,
  onFocus,
}: Omit<LevelProps, 'symbolId'> & { symbol: GraphSymbol }) {
  const [open, setOpen] = useState(false);
  // A cycle would expand forever; show it once and stop.
  const cycle = ancestors.includes(symbol.id);

  return (
    <li className="border-b border-rule last:border-b-0">
      <div className="flex min-h-11 items-center gap-1 pl-1">
        {cycle ? (
          <span
            className="w-12 shrink-0 text-center font-mono text-xs text-ink-3"
            title={t.alreadyAbove}
          >
            ↺
          </span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? t.collapse : t.expand} ${dir === 'callers' ? t.calledBy.toLowerCase() : t.calls.toLowerCase()} ${symbol.name}`}
            onClick={() => setOpen((o) => !o)}
            className="flex h-11 w-12 shrink-0 items-center justify-center font-mono text-xs text-ink-3 hover:text-ink"
          >
            <span
              aria-hidden
              className={cn('inline-block transition-transform duration-150', open && 'rotate-90')}
            >
              ›
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpen(symbol)}
          className="min-w-0 flex-1 py-2 pr-2 text-left hover:bg-paper-2"
        >
          <SymbolLine symbol={symbol} />
        </button>
        <button
          type="button"
          onClick={() => onFocus(symbol.id)}
          aria-label={`${t.center} ${symbol.name}`}
          className="h-11 shrink-0 px-3 text-xs text-ink-3 hover:text-ink"
        >
          {t.center}
        </button>
      </div>
      {open && !cycle && (
        <div className="pb-1 pl-5">
          <Level
            repo={repo}
            symbolId={symbol.id}
            dir={dir}
            ancestors={[...ancestors, symbol.id]}
            onOpen={onOpen}
            onFocus={onFocus}
          />
        </div>
      )}
    </li>
  );
}
