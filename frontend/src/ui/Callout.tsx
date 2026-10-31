import type { ReactNode } from 'react';
import { Info, Warning, WarningCircle, type Icon } from '@phosphor-icons/react';
import { isApiError } from '@/api/client';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { TextLink } from './TextLink';

type Tone = 'info' | 'warn' | 'error';

const looks: Record<Tone, { box: string; icon: string; Icon: Icon }> = {
  info: { box: 'border-accent bg-accent-wash', icon: 'text-accent', Icon: Info },
  warn: { box: 'border-warn bg-warn-wash', icon: 'text-warn', Icon: Warning },
  error: { box: 'border-error bg-error-wash', icon: 'text-error', Icon: WarningCircle },
};

export type CalloutProps = {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons or links under the text. */
  action?: ReactNode;
  /**
   * A failed request, shown as an error with its message. Offers `onRetry` unless the thing
   * is gone (404), the wait when rate limited, and a sign-in link when the session lapsed.
   */
  error?: Error;
  onRetry?: () => void;
  className?: string;
};

/** A note set off from the page: information, a warning, or a failure with a way out. */
export function Callout({
  tone = 'info',
  title,
  children,
  action,
  error,
  onRetry,
  className,
}: CalloutProps) {
  const { box, icon, Icon } = looks[error ? 'error' : tone];
  const expired = error ? isApiError(error, 401) : false;
  const wait = error && isApiError(error, 429) ? error.retryAfterSec : 0;
  const retryable = error && onRetry && !expired && !isApiError(error, 404);
  return (
    <div
      role={error || tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-sm border-l-2 px-4 py-3 text-sm', box, className)}
    >
      <Icon size={18} aria-hidden className={cn('mt-0.5 shrink-0', icon)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {error && <p className="break-words text-ink">{error.message}</p>}
        {wait ? <p className="mt-1 text-xs text-ink-3">Try again in {wait} seconds.</p> : null}
        {children && (
          <div className={cn('text-ink-2', title || error ? 'mt-1' : '')}>{children}</div>
        )}
        {(action || expired || retryable) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {expired && (
              <TextLink
                to="/sign-in"
                search={{ next: window.location.pathname + window.location.search }}
                className="py-2"
              >
                Sign in
              </TextLink>
            )}
            {retryable && (
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
