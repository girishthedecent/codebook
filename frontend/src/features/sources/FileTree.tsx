import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, FolderSimple } from '@phosphor-icons/react';
import type { SourceFile } from '@/api/types';
import { useBreakpoint } from '@/lib/breakpoints';
import { Button, Callout, EmptyState, Spinner } from '@/ui';
import { ListSkeleton } from './ListSkeleton';
import { plural } from './sourceInfo';
import { strings } from './strings';
import { useAllFiles } from './useAllFiles';
import { useOpenInViewer } from './useOpenInViewer';

type Entry =
  | { kind: 'dir'; name: string; prefix: string; count: number }
  | { kind: 'file'; name: string; file: SourceFile };

const ROW_HEIGHT = 36;
const ROW_HEIGHT_PHONE = 44;

/**
 * A repository's files one folder at a time. The full list loads once (repos are capped at a
 * few hundred files), folders are derived from paths, and long folders are virtualized. Files
 * that were left out of the index are not listed here; see `LeftOut`.
 */
export function FileTree({ sourceId }: { sourceId: string }) {
  const files = useAllFiles(sourceId);
  const [prefix, setPrefix] = useState('');
  const openInViewer = useOpenInViewer();

  const indexed = useMemo(() => files.files.filter((f) => !f.skippedReason), [files.files]);
  const entries = useMemo(() => folderEntries(indexed, prefix), [indexed, prefix]);

  const rowHeight = useBreakpoint() === 'phone' ? ROW_HEIGHT_PHONE : ROW_HEIGHT;
  const scroller = useRef<HTMLDivElement>(null);
  // No React Compiler in this app, so the virtualizer's unmemoizable API is fine here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rows = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  if (files.isPending) return <ListSkeleton label="Loading files" />;
  if (files.isError && indexed.length === 0)
    return <Callout error={files.error} onRetry={() => void files.refetch()} />;
  if (indexed.length === 0) return <EmptyState>{strings.detail.noFiles}</EmptyState>;

  const crumbs = prefix.split('/').filter(Boolean);

  return (
    <div>
      <div className="flex min-h-9 items-center gap-1 font-mono text-xs">
        {prefix && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPrefix(parentOf(prefix))}
            aria-label={strings.detail.up}
          >
            <ArrowUp size={14} aria-hidden />
          </Button>
        )}
        <nav
          aria-label="Folder"
          className="flex min-w-0 flex-wrap items-baseline gap-x-1 py-1.5 break-all max-sm:py-2.5"
        >
          <button
            type="button"
            onClick={() => setPrefix('')}
            className={crumbs.length ? 'text-ink-2 hover:text-accent' : 'text-ink'}
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
        {files.isFetchingNextPage && <Spinner className="ml-auto size-3" />}
      </div>

      <div
        ref={scroller}
        className="mt-1 max-h-[min(70vh,720px)] overflow-y-auto rounded-md border border-rule"
      >
        <ul className="relative" style={{ height: rows.getTotalSize() }}>
          {rows.getVirtualItems().map((row) => {
            const entry = entries[row.index]!;
            return (
              <li
                key={entry.kind === 'dir' ? entry.prefix : entry.file.id}
                className="absolute inset-x-0"
                style={{ top: row.start, height: rowHeight }}
              >
                {entry.kind === 'dir' ? (
                  <button
                    type="button"
                    onClick={() => setPrefix(entry.prefix)}
                    className="flex h-full w-full items-center gap-2 px-3 text-left text-ink hover:bg-paper-2"
                  >
                    <FolderSimple size={16} aria-hidden className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
                    <span className="shrink-0 text-xs text-ink-3">
                      {plural(entry.count, 'file')}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openInViewer({ kind: 'file', sourceId, path: entry.file.path })}
                    className="flex h-full w-full items-center gap-2 px-3 text-left text-ink-2 hover:bg-paper-2 hover:text-ink"
                  >
                    <span aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
                    {!!entry.file.lineCount && (
                      <span className="shrink-0 text-xs text-ink-3">
                        {plural(entry.file.lineCount, 'line')}
                      </span>
                    )}
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
