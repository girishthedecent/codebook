import { isApiError } from '@/api/client';
import { Button, Callout } from '@/ui';
import { s } from './strings';

/** One sentence and a retry. The backend's message when it has one ("File not found"). */
export function ViewError({
  error,
  onRetry,
  missing,
  message: given,
}: {
  error?: unknown;
  onRetry?: () => void;
  /** What a 404 means here, when the backend's own words won't do. */
  missing?: string;
  /** Replaces whatever the error says. */
  message?: string;
}) {
  const message =
    given ??
    (missing && isApiError(error, 404)
      ? missing
      : isApiError(error) && error.status !== 0
        ? error.message
        : s.failed);
  const retryable = !error || !isApiError(error) || error.status === 0 || error.status >= 500;
  return (
    <div className="px-5 py-6">
      <Callout
        tone="error"
        action={
          onRetry && retryable ? (
            <Button size="sm" onClick={onRetry}>
              {s.retry}
            </Button>
          ) : undefined
        }
      >
        {message}
      </Callout>
    </div>
  );
}
