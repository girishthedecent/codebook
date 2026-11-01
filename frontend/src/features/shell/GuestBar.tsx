import { Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { usageQueryOptions } from '@/api/queries/usage';
import { useMe } from '@/auth/useMe';
import { Button } from '@/ui';
import { resetPhrase } from '@/features/chat/resetTime';
import { shellStrings } from './strings';

const t = shellStrings.guest;

/**
 * Two quiet lines for demo visitors: what is left of today's allowance, and how long their
 * conversations last. Signing in from here comes back to the same page, and the guest's
 * conversations move to the account. Nothing for signed-in users.
 */
export function GuestBar() {
  const { isGuest } = useMe();
  const href = useLocation({ select: (l) => l.href });
  const usage = useQuery({ ...usageQueryOptions, enabled: isGuest });
  if (!isGuest) return null;

  const guest = usage.data?.guest;
  const left = guest ? Math.max(0, guest.limit - guest.used) : undefined;
  return (
    <div className="flex items-center justify-between gap-x-4 gap-y-2 border-b border-rule bg-paper-2 px-4 py-2 text-xs">
      <div className="min-w-0">
        {guest && left !== undefined && (
          <p className="text-ink" aria-live="polite">
            {left > 0 ? t.left(left, guest.limit) : t.none}
            {left === 0 && (
              <span className="text-ink-2">
                {' '}
                · {t.resets(resetPhrase(Date.parse(guest.resetsAt)))}
              </span>
            )}
          </p>
        )}
        <p className="text-ink-3">{t.deletion}</p>
      </div>
      <Button asChild size="sm" variant="secondary" className="shrink-0">
        <Link to="/sign-in" search={{ next: href }} aria-label={t.signInLabel}>
          {t.signIn}
        </Link>
      </Button>
    </div>
  );
}
