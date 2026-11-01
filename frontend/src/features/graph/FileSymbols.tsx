import type { GraphSymbol } from '@/api/types';
import { Skeleton } from '@/ui';
import { useSymbolMatches } from './hooks';
import { SymbolLine } from './SymbolLine';
import { ErrorNote } from './ErrorNote';
import { graphStrings as t } from './strings';

/** The symbols one file defines, the file itself first and then in the order of its lines. */
export function FileSymbols({
  repo,
  path,
  onPick,
}: {
  repo: string;
  path: string;
  onPick: (s: GraphSymbol) => void;
}) {
  const matches = useSymbolMatches(repo, path);
  // The search matches fragments anywhere in the name or qualified name; keep this file only.
  const items = (matches.data ?? [])
    .filter((s) => s.filePath === path)
    .sort((a, b) => (a.kind === 'FILE' ? -1 : b.kind === 'FILE' ? 1 : a.lineStart - b.lineStart));

  if (matches.isPending) return <Skeleton className="h-11 w-full" />;
  if (matches.error) {
    return <ErrorNote error={matches.error} onRetry={() => void matches.refetch()} />;
  }
  if (items.length === 0) return <p className="py-2 text-sm text-ink-3">{t.noFileSymbols}</p>;

  return (
    <ul>
      {items.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onPick(s)}
            className="flex min-h-11 w-full items-center rounded-sm px-2 text-left hover:bg-paper-2"
          >
            <SymbolLine symbol={s} />
          </button>
        </li>
      ))}
    </ul>
  );
}
