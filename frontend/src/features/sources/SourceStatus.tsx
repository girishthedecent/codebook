import type { Source } from '@/api/types';
import { ProgressRule } from '@/ui';
import { cn } from '@/lib/cn';
import { isIndexing, statusText } from './sourceMeta';

/** Status as a short line of text; amber while it runs, red when it failed, quiet when ready. */
export function StatusText({ source, className }: { source: Source; className?: string }) {
  return (
    <span
      className={cn(
        'text-xs whitespace-nowrap',
        source.status === 'READY' && 'text-ink-3',
        isIndexing(source.status) && 'text-warn',
        source.status === 'FAILED' && 'text-error',
        className,
      )}
    >
      {statusText(source)}
    </span>
  );
}

/** The 1px line under a source while it's indexing. Indeterminate until the first update. */
export function SourceProgress({ source, className }: { source: Source; className?: string }) {
  if (!isIndexing(source.status)) return null;
  return (
    <ProgressRule
      value={source.progress > 0 ? source.progress / 100 : undefined}
      label={`Indexing ${source.title}`}
      className={className}
    />
  );
}
