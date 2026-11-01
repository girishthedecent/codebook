import { Link } from '@tanstack/react-router';
import { X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { Button, ProgressRule, TextButton } from '@/ui';
import { formatBytes } from './sourceInfo';
import { strings } from './strings';
import { cancelUpload, clearFinished, useUploads, type Upload } from './uploadQueue';

const u = strings.uploads;

/** The books on their way up: one line each, with progress, a reason when one fails. */
export function UploadList({ workspaceId }: { workspaceId: string }) {
  const uploads = useUploads(workspaceId);
  if (!uploads.length) return null;
  const busy = uploads.some((i) => !isFinished(i));
  const finished = uploads.some(isFinished);

  return (
    <section
      aria-labelledby="uploads"
      className="mb-8 rounded-md bg-paper-2 px-4 py-3 shadow-[0_0_0_1px_var(--rule)]"
    >
      <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="uploads" className="heading-minor text-ink">
          {u.title(uploads.length)}
        </h2>
        {finished && (
          <TextButton
            className="py-1 text-xs max-sm:py-2.5"
            onClick={() => clearFinished(workspaceId)}
          >
            {u.clear}
          </TextButton>
        )}
      </div>
      {busy && <p className="text-xs text-ink-3">{u.leave}</p>}
      <ol className="mt-2 space-y-2">
        {uploads.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink">{item.name}</span>
                <span className="shrink-0 text-xs text-ink-3">{formatBytes(item.size)}</span>
              </div>
              {item.status === 'uploading' || item.status === 'saving' ? (
                <ProgressRule
                  className="mt-1"
                  value={item.status === 'saving' ? undefined : item.progress}
                  label={item.name}
                />
              ) : null}
              <p
                className={cn(
                  'mt-0.5 text-xs',
                  item.status === 'failed' ? 'text-error' : 'text-ink-3',
                )}
              >
                {statusText(item)}
                {item.status === 'done' && item.sourceId && (
                  <>
                    {' · '}
                    <Link
                      to="/w/$workspaceId/sources/$sourceId"
                      params={{ workspaceId, sourceId: item.sourceId }}
                      className="text-accent underline underline-offset-2 hover:text-accent-2"
                    >
                      {u.open}
                    </Link>
                  </>
                )}
              </p>
            </div>
            {(item.status === 'waiting' ||
              item.status === 'checking' ||
              item.status === 'uploading') && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={u.cancel(item.name)}
                title={u.cancel(item.name)}
                onClick={() => cancelUpload(workspaceId, item.id)}
              >
                <X size={14} aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const isFinished = (item: Upload) =>
  item.status === 'done' || item.status === 'failed' || item.status === 'cancelled';

function statusText(item: Upload) {
  switch (item.status) {
    case 'waiting':
      return u.waiting;
    case 'checking':
      return u.checking;
    case 'uploading':
      return u.uploading(Math.round(item.progress * 100));
    case 'saving':
      return u.saving;
    case 'done':
      return u.done;
    case 'cancelled':
      return u.cancelled;
    case 'failed':
      return item.error ?? '';
  }
}
