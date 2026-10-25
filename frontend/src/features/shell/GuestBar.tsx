import { Link, useLocation } from '@tanstack/react-router';
import { useMe } from '@/auth/useMe';
import { en } from '@/i18n/en';

/**
 * One thin line for demo visitors. Signing in from here comes back to the same page, and the
 * guest's conversations move to the account. Nothing for signed-in users.
 */
export function GuestBar() {
  const { isGuest } = useMe();
  const href = useLocation({ select: (l) => l.href });
  if (!isGuest) return null;
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 border-b border-rule bg-paper-2 px-4 py-1.5 text-xs text-ink-2">
      <span>{en.auth.guestBar}</span>
      <Link
        to="/sign-in"
        search={{ next: href }}
        className="shrink-0 text-accent underline underline-offset-2"
      >
        {en.auth.guestKeep}
      </Link>
    </div>
  );
}
