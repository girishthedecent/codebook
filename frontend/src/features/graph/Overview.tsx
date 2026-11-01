import { useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import type { GraphOverview } from '@/api/types';
import { EmptyState, SectionHeading, Skeleton, TextButton } from '@/ui';
import { cn } from '@/lib/cn';
import { FileSymbols } from './FileSymbols';
import { ErrorNote } from './ErrorNote';
import { useGraphNavigation, useOverview } from './hooks';
import { graphStrings as t, kindLabel } from './strings';

// A long contents list opens on its first rows; the rest are one button away.
const FIRST_FILES = 12;

/** Where to start in a repository: the symbols most called, then every file with its count. */
export function Overview({ repo }: { repo: string }) {
  const query = useOverview(repo);
  const nav = useGraphNavigation(repo);

  if (query.isPending) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">{t.loading}</span>
        <Skeleton className="h-6 w-1/4" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (query.error) return <ErrorNote error={query.error} onRetry={() => void query.refetch()} />;

  const { topSymbols, files, packages } = query.data;
  if (topSymbols.length === 0 && files.length === 0) {
    return <EmptyState>{t.emptyGraph}</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-12">
      {topSymbols.length > 0 && (
        <section aria-labelledby="graph-start">
          <SectionHeading id="graph-start" hint={t.startHint}>
            {t.startTitle}
          </SectionHeading>
          <ol className="grid gap-x-10 gap-y-1 lg:grid-cols-2">
            {topSymbols.map((s, i) => (
              <li key={s.id} className="flex gap-2">
                <span
                  aria-hidden
                  className="w-6 shrink-0 pt-2 text-right font-serif text-base text-ink-3 tabular-nums"
                >
                  {i + 1}
                </span>
                <StartRow symbol={s} onPick={() => nav.focus(s)} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {files.length > 0 && (
        <section aria-labelledby="graph-files" className="max-w-3xl">
          <SectionHeading id="graph-files" hint={t.filesHint}>
            {t.filesTitle}
          </SectionHeading>
          <Contents repo={repo} files={files} onPick={nav.focus} />
        </section>
      )}

      {packages.length > 0 && (
        <section aria-labelledby="graph-packages">
          <SectionHeading id="graph-packages" hint={t.packagesHint}>
            {t.packagesTitle}
          </SectionHeading>
          <ul className="flex flex-wrap gap-x-10 gap-y-3">
            {packages.map((p) => (
              <li key={p.name}>
                <span className="block font-mono text-sm text-ink">{p.name}</span>
                <span className="block text-xs text-ink-3">{t.packageCalls(p.calls)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StartRow({
  symbol,
  onPick,
}: {
  symbol: GraphOverview['topSymbols'][number];
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="min-w-0 flex-1 rounded-sm px-2 py-2 text-left hover:bg-paper-2"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 truncate font-mono text-sm font-medium text-ink">
          {symbol.name}
        </span>
        <span className="shrink-0 text-xs text-ink-3">{kindLabel(symbol.kind)}</span>
      </span>
      {symbol.signature && (
        <span className="block truncate font-mono text-xs text-ink-2">{symbol.signature}</span>
      )}
      <span className="block truncate font-mono text-xs text-ink-3">
        {symbol.filePath}:{symbol.lineStart}
      </span>
      <span className="block text-xs text-ink-3">
        {t.callCount(symbol.callers)}, {t.callsCount(symbol.calls)}
      </span>
    </button>
  );
}

/** Contents-page rows: the path, a dotted leader, the count. A row opens to the file's symbols. */
function Contents({
  repo,
  files,
  onPick,
}: {
  repo: string;
  files: GraphOverview['files'];
  onPick: (s: { qualifiedName: string }) => void;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const shown = all ? files : files.slice(0, FIRST_FILES);

  return (
    <>
      <ul>
        {shown.map((f) => {
          const expanded = open === f.path;
          return (
            <li key={f.path}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : f.path)}
                className="flex min-h-11 w-full items-end gap-2 rounded-sm px-1 pb-2.5 text-left hover:bg-paper-2"
              >
                <CaretRight
                  size={12}
                  aria-hidden
                  className={cn(
                    'mb-1.5 shrink-0 text-ink-3 transition-transform duration-150',
                    expanded && 'rotate-90',
                  )}
                />
                <span className="min-w-0 truncate font-mono text-sm text-ink">{f.path}</span>
                <span
                  aria-hidden
                  className="mb-1.5 min-w-6 flex-1 border-b border-dotted border-edge"
                />
                <span className="shrink-0 text-xs text-ink-3 tabular-nums">
                  {t.symbolsIn(f.symbols)}
                </span>
              </button>
              {expanded && (
                <div className="mb-2 ml-6">
                  <FileSymbols repo={repo} path={f.path} onPick={onPick} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {files.length > FIRST_FILES && (
        <TextButton className="mt-2 inline-flex min-h-10 items-center" onClick={() => setAll(!all)}>
          {all ? t.fewer : t.showAllFiles(files.length)}
        </TextButton>
      )}
    </>
  );
}
