import { useEffect, useState } from 'react';
import { ProgressRule, Wordmark } from '@/ui';
import { shellStrings } from './strings';

// A free-tier server sleeps when idle and takes up to a minute to start; say so once the wait
// is longer than any ordinary page load.
const SLOW_AFTER_MS = 5000;

/**
 * What a page shows while its route is still loading: the name and a thin rule, in the space
 * the page will take. After a few seconds it explains a cold start.
 */
export function PendingScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      className="flex min-h-[60dvh] flex-1 flex-col items-center justify-center gap-5 px-6 text-center"
    >
      <Wordmark size="lg" />
      <ProgressRule label={shellStrings.pending.loading} className="w-40" />
      <p className="min-h-12 max-w-[34ch] font-serif text-base text-pretty text-ink-2">
        {slow ? shellStrings.pending.waking : ''}
      </p>
    </div>
  );
}
