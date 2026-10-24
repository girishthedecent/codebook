import { appConfig } from '../../config/app.config.js';
import { rateLimitCount, sourceTotals, usageWindows } from './usage.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the fixed window that `now` falls in, as the rate limiter counts it. */
function windowStart(windowSec: number, now: number) {
  const windowMs = windowSec * 1000;
  return new Date(Math.floor(now / windowMs) * windowMs);
}

// limitKey is what the limit middleware counts this user under (see userLimitKey).
async function remaining(name: 'messagesHourly' | 'messagesDaily', limitKey: string, now: number) {
  const { points, windowSec } = appConfig.limits.windows[name];
  const used = await rateLimitCount(`${name}:${limitKey}`, windowStart(windowSec, now));
  return { limit: points, remaining: Math.max(0, points - used) };
}

/** What the user has used today and over the last 7 and 30 days, and what is left. */
export async function myUsageService(userId: string, limitKey: string, now = Date.now()) {
  const today = new Date(Math.floor(now / DAY_MS) * DAY_MS);
  const [windows, totals, hourly, daily] = await Promise.all([
    usageWindows(userId, {
      today,
      last7Days: new Date(now - 7 * DAY_MS),
      last30Days: new Date(now - 30 * DAY_MS),
    }),
    sourceTotals(userId),
    remaining('messagesHourly', limitKey, now),
    remaining('messagesDaily', limitKey, now),
  ]);

  const todayUsage = windows.get('today')!;
  const { dailyTokensPerUser, pdfStorageBytesPerUser } = appConfig.limits;
  const tokensToday = todayUsage.tokensIn + todayUsage.tokensOut;
  return {
    today: todayUsage,
    last7Days: windows.get('last7Days')!,
    last30Days: windows.get('last30Days')!,
    sources: totals.sources,
    storage: { pdfBytes: totals.pdfBytes, limitBytes: pdfStorageBytesPerUser },
    limits: {
      messagesThisHour: hourly,
      messagesToday: daily,
      tokensToday: {
        limit: dailyTokensPerUser,
        remaining: Math.max(0, dailyTokensPerUser - tokensToday),
      },
    },
  };
}
