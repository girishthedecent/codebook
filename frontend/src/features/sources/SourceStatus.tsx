import type { Source } from '@/api/types';
import { Button, ProgressRule } from '@/ui';
import { cn } from '@/lib/cn';
import { failureText, idleText, shortDate, stageLine, stuckMinutes } from './sourceInfo';
import { isIndexing } from './sourceMeta';
import { strings } from './strings';

type Props = {
  source: Source;
  /** The current time, from `useNow`, so a quiet run turns into "No progress for…" by itself. */
  now: number;
  canManage: boolean;
  onRetry: () => void;
  retrying: boolean;
  className?: string;
};

/**
 * Where a source is when it isn't ready: the stage in words with a progress line, a way out
 * when nothing has moved for too long, or why it failed. Nothing at all for a ready source.
 */
export function SourceStatus({ source, now, canManage, onRetry, retrying, className }: Props) {
  const idle = stuckMinutes(source, now);

  if (isIndexing(source.status) && idle === undefined) {
    return (
      <div className={className}>
        <ProgressRule
          value={source.progress > 0 ? source.progress / 100 : undefined}
          label={`Indexing ${source.title}`}
        />
        <p className="mt-1.5 text-xs text-ink-2">{stageLine(source)}</p>
      </div>
    );
  }

  if (idle !== undefined) {
    return (
      <p className={cn('text-xs text-ink-2', className)}>
        <span className="text-warn">{strings.noProgress(idleText(idle))}</span>{' '}
        {canManage ? <RetryButton onClick={onRetry} loading={retrying} /> : strings.stuckViewer}
      </p>
    );
  }

  if (source.status === 'FAILED') {
    return (
      <div className={cn('text-xs', className)}>
        <p className="break-words text-error">{failureText(source)}</p>
        {source.lastIngestedAt && (
          <p className="mt-0.5 text-ink-3">
            {strings.stillAvailable(shortDate(source.lastIngestedAt))}
          </p>
        )}
        {canManage && (
          <div className="mt-1">
            <RetryButton onClick={onRetry} loading={retrying} />
          </div>
        )}
      </div>
    );
  }
  return null;
}

function RetryButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick} loading={loading}>
      {strings.stuckRetry}
    </Button>
  );
}
