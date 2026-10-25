import { Link } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { Button } from '@/ui';

/**
 * A failed query inside a page that should keep its header and navigation. Says what went
 * wrong, offers a retry, and points a lapsed session at sign-in instead of a dead end.
 */
export function InlineError({
  error,
  retry,
  className,
}: {
  error: Error;
  retry: () => void;
  className?: string;
}) {
  const expired = isApiError(error, 401);
  const wait = isApiError(error, 429) && error.retryAfterSec;
  return (
    <div role="alert" className={className}>
      <p className="text-sm text-error">{error.message}</p>
      {wait ? <p className="mt-1 text-xs text-ink-3">Try again in {wait} seconds.</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {expired ? (
          <Link
            to="/sign-in"
            search={{ next: window.location.pathname + window.location.search }}
            className="py-2 text-sm text-accent underline underline-offset-2"
          >
            Sign in
          </Link>
        ) : (
          <Button size="sm" variant="secondary" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
