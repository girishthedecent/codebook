import { isApiError } from '@/api/client';
import { Button } from '@/ui';
import { s } from './strings';

/** What went wrong, in words that fit the status, with a retry where trying again can help. */
export function ErrorLine({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const status = isApiError(error) ? error.status : undefined;
  const text =
    status === 0
      ? s.offline
      : status === 401
        ? s.signInToSee
        : status === 403
          ? s.noAccess
          : status === 404
            ? s.gone
            : error.message;
  // A missing set or a refused one won't change by asking again.
  const retryable = onRetry && status !== 401 && status !== 403 && status !== 404;
  return (
    <div role="alert" className="text-sm">
      <p className="text-error">{text}</p>
      {retryable && (
        <Button size="sm" variant="secondary" className="mt-2 h-10! md:h-7!" onClick={onRetry}>
          {s.retry}
        </Button>
      )}
    </div>
  );
}
