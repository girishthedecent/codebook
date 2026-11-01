import { appConfig } from '../../config/app.config.js';
import { rateLimitCount, sourceTotals, usageByDay, usageWindows } from './usage.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 14;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

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

/**
 * A guest's question allowance for the demo: what the IP has used of today's allowance, and
 * when the window ends. `used` stops at the limit, though the counter goes on counting the
 * requests it turned away.
 */
export async function guestWindow(limitKey: string, now = Date.now()) {
  const { points, windowSec } = appConfig.limits.windows.guestMessages;
  const start = windowStart(windowSec, now);
  const used = await rateLimitCount(`guestMessages:${limitKey}`, start);
  return {
    limit: points,
    used: Math.min(used, points),
    resetsAt: new Date(start.getTime() + windowSec * 1000),
  };
}

/**
 * What the user has used today and over the last 7 and 30 days, day by day for the last 14,
 * and what is left.
 */
export async function myUsageService(userId: string, limitKey: string, now = Date.now()) {
  const today = new Date(Math.floor(now / DAY_MS) * DAY_MS);
  const [windows, totals, hourly, daily, history] = await Promise.all([
    usageWindows(userId, {
      today,
      last7Days: new Date(now - 7 * DAY_MS),
      last30Days: new Date(now - 30 * DAY_MS),
    }),
    sourceTotals(userId),
    remaining('messagesHourly', limitKey, now),
    remaining('messagesDaily', limitKey, now),
    usageByDay(userId, isoDay(now - (HISTORY_DAYS - 1) * DAY_MS), isoDay(now)),
  ]);

  const todayUsage = windows.get('today')!;
  const { dailyTokensPerUser, pdfStorageBytesPerUser } = appConfig.limits;
  const tokensToday = todayUsage.tokensIn + todayUsage.tokensOut;
  return {
    today: todayUsage,
    last7Days: windows.get('last7Days')!,
    last30Days: windows.get('last30Days')!,
    daily: history.map(({ day, answers, tokensIn, tokensOut, costUsd }) => ({
      day,
      answers,
      tokens: tokensIn + tokensOut,
      costUsd,
    })),
    // The same 14 days with tokens in and out apart and cost as a number, for charts.
    days: history.map(({ day, answers, tokensIn, tokensOut, costUsd }) => ({
      date: day,
      questions: answers,
      tokensIn,
      tokensOut,
      costUsd: Number(costUsd),
    })),
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
