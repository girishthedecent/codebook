import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { keys } from '@/api/queries/keys';
import { usageQueryOptions } from '@/api/queries/usage';
import type { Usage } from '@/api/types';
import type { LimitState } from './LimitPanel';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What the usage numbers already say: a limit used up, so asking is pointless until it resets. */
function limitFromUsage(usage: Usage, now: number): LimitState | undefined {
  const { guest, limits } = usage;
  if (guest && guest.used >= guest.limit) {
    return { code: 'GUEST_LIMIT', resetAt: Date.parse(guest.resetsAt) };
  }
  // The server counts in fixed windows: from the top of the hour, from midnight UTC.
  const nextHour = (Math.floor(now / HOUR) + 1) * HOUR;
  const nextDay = (Math.floor(now / DAY) + 1) * DAY;
  if (limits.messagesThisHour.remaining <= 0) return { code: 'HOURLY_LIMIT', resetAt: nextHour };
  if (limits.messagesToday.remaining <= 0) return { code: 'DAILY_LIMIT', resetAt: nextDay };
  if (limits.tokensToday.remaining <= 0) return { code: 'TOKEN_BUDGET', resetAt: nextDay };
  return undefined;
}

/**
 * Whether the question box should give way to the limit notice. It does when the server said
 * so in reply to a question (`block`), and also when the usage numbers show a limit used up,
 * which stops a question being sent (and a conversation being made for it) only to be refused.
 */
export function useAskLimit() {
  const client = useQueryClient();
  const usage = useQuery(usageQueryOptions);
  const [said, setSaid] = useState<LimitState>();
  const [now, setNow] = useState(Date.now);

  const fromUsage = useMemo(
    () => (usage.data ? limitFromUsage(usage.data, now) : undefined),
    [usage.data, now],
  );
  const candidate = said ?? fromUsage;
  const limit = candidate && candidate.resetAt > now ? candidate : undefined;

  const expired = useCallback(() => {
    setSaid(undefined);
    setNow(Date.now());
    void client.invalidateQueries({ queryKey: keys.usage });
  }, [client]);

  return { limit, block: setSaid, expired };
}
