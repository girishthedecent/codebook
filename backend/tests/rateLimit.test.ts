import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { genericErrorHandler } from '../src/middlewares/error.middleware.js';
import { limit, perGuestIp, type LimitKey } from '../src/middlewares/rateLimit.middleware.js';
import {
  consume,
  pruneRateLimitHits,
  takeEventStreamSlot,
  withRerankSlot,
} from '../src/utils/rateLimit.js';
import { TooManyRequestsError } from '../src/utils/errors/app.error.js';
import { resetDb } from './helpers/db.js';

beforeEach(async () => {
  await resetDb();
});

const { points: searchPoints, windowSec: searchWindow } = appConfig.limits.windows.search;

/** An app with one limited route; the "user" comes from headers instead of a session. */
function limitedApp(name: Parameters<typeof limit>[0], keyOf?: LimitKey) {
  const app = express();
  app.use((req, res, next) => {
    res.locals.user = {
      id: req.get('x-user') ?? 'u1',
      isGuest: req.get('x-guest') === '1',
    } as never;
    next();
  });
  app.get('/limited', limit(name, keyOf), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(genericErrorHandler);
  return request(app);
}

describe('consume', () => {
  it('allows the configured number of requests per window, then refuses with the wait', async () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 10);
    for (let i = 0; i < searchPoints; i++) {
      expect((await consume('search', 'user:a', now)).allowed).toBe(true);
    }
    const refused = await consume('search', 'user:a', now);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBe(searchWindow - 10);
  });

  it('starts over in the next window', async () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0);
    for (let i = 0; i <= searchPoints; i++) await consume('search', 'user:a', now);
    expect((await consume('search', 'user:a', now)).allowed).toBe(false);

    const next = now + searchWindow * 1000;
    expect((await consume('search', 'user:a', next)).allowed).toBe(true);
  });

  it('counts keys and limit names apart', async () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0);
    for (let i = 0; i <= searchPoints; i++) await consume('search', 'user:a', now);

    expect((await consume('search', 'user:b', now)).allowed).toBe(true);
    expect((await consume('study', 'user:a', now)).allowed).toBe(true);
  });

  it('counts every one of many parallel requests', async () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0);
    const results = await Promise.all(
      Array.from({ length: searchPoints + 15 }, () => consume('search', 'user:a', now)),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(searchPoints);
    const [row] = await prismaClient.rateLimitHit.findMany({ where: { key: 'search:user:a' } });
    expect(row!.count).toBe(searchPoints + 15);
  });

  it('counts web searches per UTC calendar month', async () => {
    const now = Date.UTC(2026, 9, 24, 12, 0, 0);
    const result = await consume('webSearchMonthly', 'global', now);

    expect(result.retryAfterSec).toBe((Date.UTC(2026, 10, 1) - now) / 1000);
    const [row] = await prismaClient.rateLimitHit.findMany();
    expect(row!.windowStart).toEqual(new Date(Date.UTC(2026, 9, 1)));

    const { points } = appConfig.limits.windows.webSearchMonthly;
    await prismaClient.rateLimitHit.update({
      where: { key_windowStart: { key: row!.key, windowStart: row!.windowStart } },
      data: { count: points },
    });
    expect((await consume('webSearchMonthly', 'global', now)).allowed).toBe(false);
    expect((await consume('webSearchMonthly', 'global', Date.UTC(2026, 10, 1))).allowed).toBe(true);
  });
});

describe('pruneRateLimitHits', () => {
  const cutoff = new Date(Date.UTC(2026, 9, 22, 12, 0, 0));

  async function hit(key: string, windowStart: Date) {
    await prismaClient.rateLimitHit.create({ data: { key, windowStart, count: 1 } });
  }

  it('deletes a window once it has ended, whatever its length', async () => {
    await hit('search:user:a', new Date(Date.UTC(2026, 9, 20, 12, 0, 0)));
    await hit('search:user:a', new Date(Date.UTC(2026, 9, 24, 12, 0, 0)));
    await hit('messagesDaily:user:a', new Date(Date.UTC(2026, 9, 21)));
    await hit('messagesDaily:user:a', new Date(Date.UTC(2026, 9, 22)));
    await hit('retired:user:a', new Date(Date.UTC(2026, 9, 20)));

    const { count } = await pruneRateLimitHits(cutoff);

    expect(count).toBe(3);
    const left = await prismaClient.rateLimitHit.findMany({ orderBy: { key: 'asc' } });
    expect(left.map((row) => [row.key, row.windowStart.toISOString()])).toEqual([
      ['messagesDaily:user:a', '2026-10-22T00:00:00.000Z'],
      ['search:user:a', '2026-10-24T12:00:00.000Z'],
    ]);
  });

  it('keeps the current month of web searches and deletes ended months', async () => {
    await hit('webSearchMonthly:global', new Date(Date.UTC(2026, 9, 1)));
    await hit('webSearchMonthly:global', new Date(Date.UTC(2026, 8, 1)));

    const { count } = await pruneRateLimitHits(cutoff);

    expect(count).toBe(1);
    const [row] = await prismaClient.rateLimitHit.findMany();
    expect(row!.windowStart).toEqual(new Date(Date.UTC(2026, 9, 1)));
  });
});

describe('limit middleware', () => {
  // Real requests take real time: start each test at the beginning of a minute, so a run
  // never straddles two fixed windows.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 24, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('answers 429 with Retry-After once the window is used up', async () => {
    const app = limitedApp('search');
    for (let i = 0; i < searchPoints; i++) {
      expect((await app.get('/limited')).status).toBe(200);
    }

    const res = await app.get('/limited');

    expect(res.status).toBe(429);
    expect(Number(res.get('Retry-After'))).toBeGreaterThan(0);
    expect(Number(res.get('Retry-After'))).toBeLessThanOrEqual(searchWindow);
    expect(res.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
  });

  it('counts each signed-up user on their own', async () => {
    const app = limitedApp('search');
    for (let i = 0; i < searchPoints; i++) await app.get('/limited').set('x-user', 'alice');

    expect((await app.get('/limited').set('x-user', 'alice')).status).toBe(429);
    expect((await app.get('/limited').set('x-user', 'bob')).status).toBe(200);
  });

  it('counts guests by IP, so a new guest account does not start over', async () => {
    const app = limitedApp('search');
    for (let i = 0; i < searchPoints; i++) {
      await app.get('/limited').set('x-user', `guest-${i}`).set('x-guest', '1');
    }

    const res = await app.get('/limited').set('x-user', 'guest-new').set('x-guest', '1');

    expect(res.status).toBe(429);
  });

  it('applies a guests-only limit to guests and lets signed-up users through', async () => {
    const { points } = appConfig.limits.windows.guestMessages;
    const app = limitedApp('guestMessages', perGuestIp);
    for (let i = 0; i < points; i++) await app.get('/limited').set('x-guest', '1');

    expect((await app.get('/limited').set('x-guest', '1')).status).toBe(429);
    expect((await app.get('/limited')).status).toBe(200);
  });
});

describe('429s thrown from services', () => {
  it('get Retry-After from the error', async () => {
    const app = express();
    app.get('/budget', () => {
      throw new TooManyRequestsError(42);
    });
    app.use(genericErrorHandler);

    const res = await request(app).get('/budget');

    expect(res.status).toBe(429);
    expect(res.get('Retry-After')).toBe('42');
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 42 } });
  });
});

describe('rerank slots', () => {
  it('runs at most the configured number at once and skips the rest', async () => {
    const slots = appConfig.limits.concurrentReranks;
    const gates: (() => void)[] = [];
    const running = Array.from({ length: slots }, () =>
      withRerankSlot(() => new Promise<string>((resolve) => gates.push(() => resolve('done')))),
    );

    expect(await withRerankSlot(async () => 'extra')).toEqual({ ran: false });

    gates.forEach((open) => open());
    expect(await Promise.all(running)).toEqual(
      Array.from({ length: slots }, () => ({ ran: true, value: 'done' })),
    );
    expect(await withRerankSlot(async () => 'after')).toEqual({ ran: true, value: 'after' });
  });

  it('frees the slot when the work fails', async () => {
    for (let i = 0; i < appConfig.limits.concurrentReranks + 1; i++) {
      await expect(withRerankSlot(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    }
    expect(await withRerankSlot(async () => 1)).toEqual({ ran: true, value: 1 });
  });
});

describe('event stream slots', () => {
  it('caps open streams per user and frees a slot once, on release', () => {
    const max = appConfig.limits.openEventStreamsPerUser;
    const releases = Array.from({ length: max }, () => takeEventStreamSlot('alice'));
    expect(releases.every((release) => release !== null)).toBe(true);
    expect(takeEventStreamSlot('alice')).toBeNull();
    expect(takeEventStreamSlot('bob')).not.toBeNull();

    releases[0]!();
    releases[0]!();
    expect(takeEventStreamSlot('alice')).not.toBeNull();
    expect(takeEventStreamSlot('alice')).toBeNull();
  });
});
