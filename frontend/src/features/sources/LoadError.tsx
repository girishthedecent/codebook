import { isApiError } from '@/api/client';
import { Button } from '@/ui';
import { strings } from './strings';

/** A failed load: the backend's message and a way to try again, instead of a dead end. */
export function LoadError({
  error,
  onRetry,
  className,
}: {
  error: Error;
  onRetry: () => void;
  className?: string;
}) {
  // A 404 won't come back by asking again.
  const retryable = !isApiError(error, 404);
  return (
    <div role="alert" className={className ?? 'py-4 text-sm'}>
      <p className="break-words text-error">{error.message}</p>
      {retryable && (
        <Button size="sm" className="mt-2 max-sm:h-10" onClick={onRetry}>
          {strings.retry}
        </Button>
      )}
    </div>
  );
}
