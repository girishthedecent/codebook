import { isApiError } from '@/api/client';
import { Button } from '@/ui';
import { graphStrings as t } from './strings';

/** A failure in plain words, with a retry when asking again could help. */
export function ErrorLine({
  error,
  fallback = t.error,
  onRetry,
}: {
  error: Error;
  fallback?: string;
  onRetry?: () => void;
}) {
  const status = isApiError(error) ? error.status : undefined;
  const text = status === 0 ? t.offline : status === 404 ? t.notFound : fallback;
  return (
    <div role="alert" className="text-sm">
      <p className="text-error">{text}</p>
      {onRetry && status !== 404 && (
        <Button size="sm" variant="secondary" className="mt-2 h-10! md:h-7!" onClick={onRetry}>
          {t.retry}
        </Button>
      )}
    </div>
  );
}
