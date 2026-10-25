import type { GraphSymbol } from '@/api/types';
import { cn } from '@/lib/cn';
import { kindLabel } from './strings';

type Sym = Pick<GraphSymbol, 'kind' | 'name' | 'filePath' | 'lineStart'>;

/** `fn  handle   lib/router/index.js:139` — the one-line form used in lists and the tree. */
export function SymbolLine({ symbol, className }: { symbol: Sym; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-baseline gap-2 font-mono text-xs', className)}>
      <span className="w-11 shrink-0 text-ink-3">
        {kindLabel[symbol.kind] ?? symbol.kind.toLowerCase()}
      </span>
      <span className="shrink-0 text-ink">{symbol.name}</span>
      <span className="min-w-0 truncate text-ink-3">
        {symbol.filePath}:{symbol.lineStart}
      </span>
    </span>
  );
}
