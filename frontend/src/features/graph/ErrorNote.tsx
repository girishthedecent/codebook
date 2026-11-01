import { isApiError } from '@/api/client';
import { Button, Callout } from '@/ui';
import { graphStrings as t } from './strings';

/**
 * A failed request in words that fit it. Most failures show the server's message and a way
 * to ask again, with the reference support can look up; a missing or ambiguous symbol is
 * explained instead.
 */
export function ErrorNote({
  error,
  title,
  onRetry,
  className,
}: {
  error: Error;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const status = isApiError(error) ? error.status : undefined;
  const reference = isApiError(error) ? error.correlationId : undefined;

  if (status === 404) {
    return (
      <Callout tone="warn" className={className}>
        {t.notFound}
      </Callout>
    );
  }
  if (status === 409) {
    return (
      <Callout tone="warn" className={className}>
        {t.ambiguous}
      </Callout>
    );
  }
  if (status === 0) {
    return (
      <Callout
        tone="error"
        title={title}
        className={className}
        action={
          onRetry && (
            <Button size="sm" onClick={onRetry}>
              {t.retry}
            </Button>
          )
        }
      >
        {t.offline}
      </Callout>
    );
  }
  return (
    <Callout error={error} onRetry={onRetry} className={className}>
      {title && <p className="text-ink-2">{title}</p>}
      {reference && (
        <p className="mt-1 text-xs text-ink-3">
          {t.correlation} <span className="font-mono">{reference}</span>
        </p>
      )}
    </Callout>
  );
}
