import { appConfig } from '../config/app.config.js';
import prismaClient from '../config/db.config.js';
import { TooManyRequestsError, type RateLimitCode } from './errors/app.error.js';

export type LimitName = keyof typeof appConfig.limits.windows;

export type LimitResult = { allowed: boolean; retryAfterSec: number };

const limitNames = Object.keys(appConfig.limits.windows) as LimitName[];

function monthStart(date: Date, monthsAhead = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthsAhead, 1));
}

/** The window of `name` that `now` falls in: [start, end). */
function windowAt(name: LimitName, now: number) {
  const limit = appConfig.limits.windows[name];
  if ('calendarMonth' in limit) {
    return { start: monthStart(new Date(now)), end: monthStart(new Date(now), 1) };
  }
  const windowMs = limit.windowSec * 1000;
  const start = Math.floor(now / windowMs) * windowMs;
  return { start: new Date(start), end: new Date(start + windowMs) };
}

/** Windows of `name` that start before this date had all ended by `cutoff`. */
function endedBy(name: LimitName, cutoff: Date) {
  const limit = appConfig.limits.windows[name];
  if ('calendarMonth' in limit) return monthStart(cutoff);
  return new Date(cutoff.getTime() - limit.windowSec * 1000);
}

/**
 * Counts one request against the current window and says whether it is still within the
 * limit. The insert-or-increment is one statement, so parallel requests can't both read
 * the old count; a request over the limit is still counted, which only matters until the
 * window ends.
 */
export async function consume(
  name: LimitName,
  key: string,
  now = Date.now(),
): Promise<LimitResult> {
  const { start, end } = windowAt(name, now);
  const [row] = await prismaClient.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitHit" (key, "windowStart", count)
    VALUES (${`${name}:${key}`}, ${start}, 1)
    ON CONFLICT (key, "windowStart") DO UPDATE SET count = "RateLimitHit".count + 1
    RETURNING count
  `;
  const retryAfterSec = Math.max(1, Math.ceil((end.getTime() - now) / 1000));
  return { allowed: row!.count <= appConfig.limits.windows[name].points, retryAfterSec };
}

const { guestMessages, messagesHourly, messagesDaily } = appConfig.limits.windows;

// The limits on asking questions get their own code and wording, so a client can say which
// one it ran into. The rest are plain RATE_LIMITED.
const LIMIT_ERRORS: Partial<Record<LimitName, { code: RateLimitCode; message: string }>> = {
  guestMessages: {
    code: 'GUEST_LIMIT',
    message: `The demo allows ${guestMessages.points} questions a day. Sign up to ask more, or come back when it resets.`,
  },
  messagesHourly: {
    code: 'HOURLY_LIMIT',
    message: `You can ask ${messagesHourly.points} questions an hour. Try again when the hour is up.`,
  },
  messagesDaily: {
    code: 'DAILY_LIMIT',
    message: `You can ask ${messagesDaily.points} questions a day. Try again tomorrow.`,
  },
};

/** The 429 for a window of `name` that is used up. */
export function limitError(name: LimitName, retryAfterSec: number) {
  const known = LIMIT_ERRORS[name];
  return new TooManyRequestsError(retryAfterSec, known?.code, known?.message);
}

/** consume() for services and tools: throws a 429 when the limit is used up. */
export async function assertWithinLimit(name: LimitName, key: string) {
  const { allowed, retryAfterSec } = await consume(name, key);
  if (!allowed) throw limitError(name, retryAfterSec);
}

/**
 * Gives back one point of the window that `at` falls in, for a request that cost nothing
 * (the models were out of quota). Pass the time the request was counted, so a refund after
 * midnight doesn't take a point from the next day's window.
 */
export async function refund(name: LimitName, key: string, at = Date.now()) {
  const { start } = windowAt(name, at);
  await prismaClient.rateLimitHit.updateMany({
    where: { key: `${name}:${key}`, windowStart: start, count: { gt: 0 } },
    data: { count: { decrement: 1 } },
  });
}

/**
 * Deletes the counters of windows that ended before `cutoff`; they are never read again.
 * Windows differ in length per limit (the key starts with its name), so a month's counter
 * stays while it is still counting.
 */
export async function pruneRateLimitHits(cutoff: Date) {
  const deleted = await prismaClient.$transaction([
    ...limitNames.map((name) =>
      prismaClient.rateLimitHit.deleteMany({
        where: { key: { startsWith: `${name}:` }, windowStart: { lt: endedBy(name, cutoff) } },
      }),
    ),
    // Counters of limits that no longer exist.
    prismaClient.rateLimitHit.deleteMany({
      where: {
        windowStart: { lt: cutoff },
        NOT: limitNames.map((name) => ({ key: { startsWith: `${name}:` } })),
      },
    }),
  ]);
  return { count: deleted.reduce((sum, { count }) => sum + count, 0) };
}

// Reranking runs on this process's CPU for seconds at a time. Past this many at once a
// search goes on without it instead of waiting for a slot.
let rerankSlotsInUse = 0;

export async function withRerankSlot<T>(
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (rerankSlotsInUse >= appConfig.limits.concurrentReranks) return { ran: false };
  rerankSlotsInUse += 1;
  try {
    return { ran: true, value: await fn() };
  } finally {
    rerankSlotsInUse -= 1;
  }
}

// Progress streams stay open for minutes; this caps how many one user holds at once.
const openEventStreams = new Map<string, number>();

/** Takes a stream slot for the user: a release function, or null when all are in use. */
export function takeEventStreamSlot(userId: string): (() => void) | null {
  const open = openEventStreams.get(userId) ?? 0;
  if (open >= appConfig.limits.openEventStreamsPerUser) return null;
  openEventStreams.set(userId, open + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (openEventStreams.get(userId) ?? 1) - 1;
    if (left > 0) openEventStreams.set(userId, left);
    else openEventStreams.delete(userId);
  };
}
