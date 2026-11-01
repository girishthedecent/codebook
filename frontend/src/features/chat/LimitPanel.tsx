import { useEffect, useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { Button, Card } from '@/ui';
import { ComposerDock } from './Composer';
import { resetPhrase } from './resetTime';
import { chat } from './strings';

/** A question that can't be asked yet: which limit stopped it, when it ends, and what was typed. */
export type LimitState = {
  code: string;
  /** Epoch ms when asking works again. */
  resetAt: number;
  question?: string;
};

type LimitCode = keyof typeof chat.limit;

function isLimitCode(code: string): code is LimitCode {
  return code in chat.limit;
}

/** Whole seconds until `at`, ticking once a second. */
function useSecondsUntil(at: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * Takes the question box's place when a limit has been reached, and says which one and when
 * it ends in the reader's own time. The question they wrote stays safe in the draft. Guests
 * are offered the way to an allowance of their own. It hands the box back when the time is up.
 */
export function LimitPanel({
  limit,
  isGuest,
  onExpired,
}: {
  limit: LimitState;
  isGuest: boolean;
  onExpired: () => void;
}) {
  const href = useLocation({ select: (l) => l.href });
  const left = useSecondsUntil(limit.resetAt);
  useEffect(() => {
    if (left === 0) onExpired();
  }, [left, onExpired]);

  const words = chat.limit[isLimitCode(limit.code) ? limit.code : 'RATE_LIMITED'];
  const when =
    left < 90 ? `in ${left} ${left === 1 ? 'second' : 'seconds'}` : resetPhrase(limit.resetAt);
  return (
    <ComposerDock>
      <Card className="mx-auto w-full max-w-[720px]" role="status">
        <h2 className="heading-minor text-ink">{words.title}</h2>
        <p className="mt-1 font-serif text-base text-pretty text-ink-2">{words.body(when)}</p>
        {limit.question && (
          <p className="mt-3 line-clamp-2 font-serif text-sm text-ink-3 italic">
            “{limit.question}”
          </p>
        )}
        <p className="mt-1 text-xs text-ink-3">{chat.limitKept}</p>
        {isGuest && (
          <Button asChild variant="primary" className="mt-4">
            <Link to="/sign-in" search={{ next: href }}>
              {chat.limitSignIn}
            </Link>
          </Button>
        )}
      </Card>
    </ComposerDock>
  );
}
