import { isApiError } from '@/api/client';
import { Button } from '@/ui';
import { s } from './strings';

/** One sentence and a retry. The backend's message when it has one ("File not found"). */
export function ViewError({
  error,
  onRetry,
  missing,
}: {
  error: unknown;
  onRetry?: () => void;
  /** What a 404 means here, when the backend's own words won't do. */
  missing?: string;
}) {
  const message =
    missing && isApiError(error, 404)
      ? missing
      : isApiError(error) && error.status !== 0
        ? error.message
        : s.failed;
  const retryable = !isApiError(error) || error.status === 0 || error.status >= 500;
  return (
    <div className="px-5 py-6">
      <p className="text-sm text-ink-2">{message}</p>
      {onRetry && retryable && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          {s.retry}
        </Button>
      )}
    </div>
  );
}
