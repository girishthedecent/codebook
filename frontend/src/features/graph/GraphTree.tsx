import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowsClockwise, CaretRight } from '@phosphor-icons/react';
import { graphCallersQueryOptions, graphDependenciesQueryOptions } from '@/api/queries';
import type { GraphSymbol } from '@/api/types';
import { Button, SectionHeading, Skeleton, TextButton } from '@/ui';
import { cn } from '@/lib/cn';
import { ErrorNote } from './ErrorNote';
import { Outside } from './Outside';
import { graphStrings as t, kindLabel } from './strings';

type Dir = 'callers' | 'dependencies';

type Actions = {
  onOpen: (symbol: GraphSymbol) => void;
  onFocus: (symbol: GraphSymbol) => void;
};

// Longer lists show their first rows and a button for the rest.
const FIRST_ROWS = 10;

type Props = Actions & {
  repo: string;
  center: GraphSymbol;
  /** Package names from the overview, to tell libraries apart from unmatched calls. */
  packages: string[];
};

/**
 * Who calls the symbol and what it calls, side by side on wide screens and one above the
 * other on a phone. Each row opens its next hop in place, which is the way to walk the graph
 * without the map.
 */
export function Connections({ repo, center, packages, onOpen, onFocus }: Props) {
  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2 lg:[&>*+*]:border-l lg:[&>*+*]:border-rule lg:[&>*+*]:pl-12">
      <Column
        repo={repo}
        center={center}
        dir="callers"
        packages={packages}
        onOpen={onOpen}
        onFocus={onFocus}
      />
      <Column
        repo={repo}
        center={center}
        dir="dependencies"
        packages={packages}
        onOpen={onOpen}
        onFocus={onFocus}
      />
    </div>
  );
}

function Column({ repo, center, dir, packages, onOpen, onFocus }: Props & { dir: Dir }) {
  // Two queries with one enabled: their result types differ, so they can't share a call.
  const callers = useQuery({
    ...graphCallersQueryOptions(repo, center.qualifiedName, 1),
    enabled: dir === 'callers',
  });
  const dependencies = useQuery({
    ...graphDependenciesQueryOptions(repo, center.qualifiedName, 1),
    enabled: dir === 'dependencies',
  });
  const query = dir === 'callers' ? callers : dependencies;
  const headingId = useId();
  const count = query.data?.symbols.length;

  return (
    <section aria-labelledby={headingId}>
      <SectionHeading
        as="h3"
        id={headingId}
        hint={count === undefined ? undefined : symbolCount(count, query.data?.truncated)}
      >
        {dir === 'callers' ? t.calledBy : t.calls}
      </SectionHeading>
      {query.isPending ? (
        <RowsLoading />
      ) : query.error ? (
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Rows
            symbols={query.data.symbols}
            truncated={query.data.truncated}
            repo={repo}
            dir={dir}
            ancestors={[center.id]}
            onOpen={onOpen}
            onFocus={onFocus}
          />
          {dir === 'dependencies' && dependencies.data && (
            <Outside external={dependencies.data.external} packages={packages} className="mt-8" />
          )}
        </>
      )}
    </section>
  );
}

const symbolCount = (n: number, truncated?: boolean) =>
  `${n} ${n === 1 ? 'symbol' : 'symbols'}${truncated ? ', the nearest of more' : ''}`;

function RowsLoading() {
  return (
    <div className="flex flex-col gap-3 pt-1" role="status">
      <span className="sr-only">{t.loading}</span>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

type RowsProps = Actions & {
  repo: string;
  symbols: GraphSymbol[];
  truncated: boolean;
  dir: Dir;
  ancestors: string[];
};

function Rows({ symbols, truncated, repo, dir, ancestors, onOpen, onFocus }: RowsProps) {
  const [all, setAll] = useState(false);
  const sorted = [...symbols].sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.lineStart - b.lineStart,
  );
  if (sorted.length === 0) {
    return (
      <p className="py-2 text-sm text-ink-3">
        {dir === 'callers' ? t.nothingCalls : t.callsNothing}
      </p>
    );
  }
  const shown = all ? sorted : sorted.slice(0, FIRST_ROWS);
  return (
    <>
      <ul>
        {shown.map((s) => (
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
      </ul>
      {sorted.length > FIRST_ROWS && (
        <TextButton className="mt-2 inline-flex min-h-10 items-center" onClick={() => setAll(!all)}>
          {all ? t.fewer : t.more(sorted.length - FIRST_ROWS)}
        </TextButton>
      )}
      {truncated && <p className="mt-2 text-xs text-ink-3">{t.truncated}</p>}
    </>
  );
}

/** One more hop from a row, fetched when the row is opened. */
function Level({
  repo,
  symbol,
  dir,
  ancestors,
  onOpen,
  onFocus,
}: Omit<RowsProps, 'symbols' | 'truncated'> & { symbol: GraphSymbol }) {
  const callers = useQuery({
    ...graphCallersQueryOptions(repo, symbol.qualifiedName, 1),
    enabled: dir === 'callers',
  });
  const dependencies = useQuery({
    ...graphDependenciesQueryOptions(repo, symbol.qualifiedName, 1),
    enabled: dir === 'dependencies',
  });
  const query = dir === 'callers' ? callers : dependencies;

  if (query.isPending) return <RowsLoading />;
  if (query.error) {
    return <ErrorNote error={query.error} onRetry={() => void query.refetch()} />;
  }
  return (
    <Rows
      symbols={query.data.symbols}
      truncated={query.data.truncated}
      repo={repo}
      dir={dir}
      ancestors={ancestors}
      onOpen={onOpen}
      onFocus={onFocus}
    />
  );
}

function Row({
  repo,
  symbol,
  dir,
  ancestors,
  onOpen,
  onFocus,
}: Omit<RowsProps, 'symbols' | 'truncated'> & { symbol: GraphSymbol }) {
  const [open, setOpen] = useState(false);
  // A cycle would expand forever; show it once and stop.
  const cycle = ancestors.includes(symbol.id);

  return (
    <li>
      <div className="flex items-start gap-1">
        {cycle ? (
          <span
            title={t.alreadyAbove}
            className="flex size-10 shrink-0 items-center justify-center text-ink-3"
          >
            <ArrowsClockwise size={14} aria-hidden />
            <span className="sr-only">{t.alreadyAbove}</span>
          </span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? t.collapse : t.expand} ${dir === 'callers' ? t.calledBy.toLowerCase() : t.calls.toLowerCase()} ${symbol.name}`}
            onClick={() => setOpen((o) => !o)}
            className="flex size-10 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <CaretRight
              size={12}
              aria-hidden
              className={cn('transition-transform duration-150', open && 'rotate-90')}
            />
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpen(symbol)}
          title={t.openInViewer}
          className="min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left hover:bg-paper-2"
        >
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate font-mono text-sm text-ink">{symbol.name}</span>
            <span className="shrink-0 text-xs text-ink-3">{kindLabel(symbol.kind)}</span>
          </span>
          <span className="block truncate font-mono text-xs text-ink-3">
            {symbol.filePath}:{symbol.lineStart}
          </span>
          {symbol.signature && (
            <span className="block truncate font-mono text-xs text-ink-2">{symbol.signature}</span>
          )}
        </button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${t.center} ${symbol.name}`}
          onClick={() => onFocus(symbol)}
        >
          {t.center}
        </Button>
      </div>
      {open && !cycle && (
        <div className="mb-2 ml-5 border-l border-rule pl-3">
          <Level
            repo={repo}
            symbol={symbol}
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
