import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp } from '@phosphor-icons/react';
import { flatItems } from '@/api/queries/keys';
import { useSourceFiles } from '@/api/queries/sources';
import type { SourceFile } from '@/api/types';
import { Spinner } from '@/ui';
import { strings } from './strings';
import { useOpenInViewer } from './useOpenInViewer';

type Entry =
  | { kind: 'dir'; name: string; prefix: string; count: number }
  | { kind: 'file'; name: string; file: SourceFile };

const ROW_HEIGHT = 36;
// The files endpoint is flat; folders are built here. Repos are capped well below this.
const MAX_PAGES = 30;

/**
 * A repository's files one folder at a time. The full list loads once (repos are capped at a
 * few hundred files), folders are derived from paths, and long folders are virtualized.
 */
export function FileTree({ sourceId }: { sourceId: string }) {
  const files = useSourceFiles(sourceId);
  const [prefix, setPrefix] = useState('');
  const openInViewer = useOpenInViewer();
  const { hasNextPage, isFetchingNextPage, fetchNextPage, data } = files;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && (data?.pages.length ?? 0) < MAX_PAGES) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, data?.pages.length]);

  const all = useMemo(() => flatItems(data), [data]);
  const entries = useMemo(() => folderEntries(all, prefix), [all, prefix]);

  const scroller = useRef<HTMLDivElement>(null);
  // No React Compiler in this app, so the virtualizer's unmemoizable API is fine here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rows = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (files.isPending) return <Loading />;
  if (files.isError) return <p className="py-4 text-sm text-error">{files.error.message}</p>;
  if (all.length === 0) return <p className="py-4 text-sm text-ink-3">{strings.detail.noFiles}</p>;

  const crumbs = prefix.split('/').filter(Boolean);

  return (
    <div className="py-2">
      <div className="flex min-h-9 items-center gap-2 border-b border-rule font-mono text-xs">
        {prefix && (
          <button
            type="button"
            onClick={() => setPrefix(parentOf(prefix))}
            aria-label={strings.detail.up}
            className="flex size-7 items-center justify-center rounded-xs text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <ArrowUp size={14} />
          </button>
        )}
        <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-baseline gap-x-1 py-1.5">
          <button
            type="button"
            onClick={() => setPrefix('')}
            className="text-ink-2 hover:text-accent"
          >
            /
          </button>
          {crumbs.map((part, i) => (
            <span key={i} className="flex items-baseline gap-x-1">
              <button
                type="button"
                onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/') + '/')}
                className={i === crumbs.length - 1 ? 'text-ink' : 'text-ink-2 hover:text-accent'}
              >
                {part}
              </button>
              <span className="text-ink-3">/</span>
            </span>
          ))}
        </nav>
        {isFetchingNextPage && <Spinner className="ml-auto size-3" />}
      </div>

      <div ref={scroller} className="max-h-[min(70vh,720px)] overflow-y-auto">
        <ul className="relative" style={{ height: rows.getTotalSize() }}>
          {rows.getVirtualItems().map((row) => {
            const entry = entries[row.index]!;
            return (
              <li
                key={entry.kind === 'dir' ? entry.prefix : entry.file.id}
                className="absolute inset-x-0 border-b border-rule"
                style={{ top: row.start, height: ROW_HEIGHT }}
              >
                {entry.kind === 'dir' ? (
                  <button
                    type="button"
                    onClick={() => setPrefix(entry.prefix)}
                    className="flex h-full w-full items-center justify-between gap-3 px-1 text-left font-mono text-xs text-ink hover:bg-paper-2"
                  >
                    <span className="truncate">{entry.name}/</span>
                    <span className="shrink-0 text-ink-3">{entry.count}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!!entry.file.skippedReason}
                    onClick={() => openInViewer({ kind: 'file', sourceId, path: entry.file.path })}
                    className="flex h-full w-full items-center justify-between gap-3 px-1 text-left font-mono text-xs text-ink-2 hover:bg-paper-2 hover:text-ink disabled:text-ink-3 disabled:hover:bg-transparent"
                  >
                    <span className="truncate">{entry.name}</span>
                    <span className="shrink-0 text-ink-3">
                      {entry.file.skippedReason
                        ? strings.detail.skipped
                        : entry.file.lineCount
                          ? `${entry.file.lineCount} lines`
                          : ''}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Folders first, then files, both alphabetical; each folder knows how many files it holds. */
function folderEntries(files: SourceFile[], prefix: string): Entry[] {
  const dirs = new Map<string, number>();
  const here: Entry[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) here.push({ kind: 'file', name: rest, file });
    else {
      const name = rest.slice(0, slash);
      dirs.set(name, (dirs.get(name) ?? 0) + 1);
    }
  }
  const folders: Entry[] = [...dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ kind: 'dir', name, prefix: `${prefix}${name}/`, count }));
  here.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...here];
}

function parentOf(prefix: string) {
  const parts = prefix.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? parts.join('/') + '/' : '';
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-ink-3">
      <Spinner className="size-3.5" /> Loading
    </div>
  );
}
