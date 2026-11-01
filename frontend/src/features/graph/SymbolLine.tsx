import type { GraphSymbol } from '@/api/types';
import { cn } from '@/lib/cn';
import { kindLabel } from './strings';

type Sym = Pick<GraphSymbol, 'kind' | 'name' | 'filePath' | 'lineStart'>;

/** `function  handle   lib/router/index.js:139`: the one-line form used in pickers and lists. */
export function SymbolLine({ symbol, className }: { symbol: Sym; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-baseline gap-2', className)}>
      <span className="w-16 shrink-0 text-xs text-ink-3">{kindLabel(symbol.kind)}</span>
      <span className="max-w-[55%] shrink-0 truncate font-mono text-sm text-ink">
        {symbol.name}
      </span>
      <span className="min-w-0 truncate font-mono text-xs text-ink-3">
        {symbol.filePath}:{symbol.lineStart}
      </span>
    </span>
  );
}
