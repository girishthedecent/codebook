import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { inngest } from '../src/config/inngest.config.js';
import { resetCircuitBreaker } from '../src/llm/circuitBreaker.js';
import { textRoutes } from '../src/llm/models.js';
import { consume, refund } from '../src/utils/rateLimit.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { apiError, streamingModel, useModels, type StreamTurn } from './helpers/llm-mock.js';
import { seedSource, vectorOf } from './helpers/retrieval.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));

type User = Awaited<ReturnType<typeof signedInUser>>;
type ErrorBody = {
  success: false;
  message: string;
  code: string;
  retryAfterSec?: number;
  details?: unknown;
};

const PRIMARY = textRoutes.agent.primary.model;
const FALLBACK = textRoutes.agent.fallback!.model;
const ANSWER: StreamTurn[] = [
  { toolCalls: [{ name: 'search_sources', input: { query: 'what is a salt' } }] },
  { text: 'A salt is random data added to each password [1].' },
];
const { guestMessages, messagesHourly, messagesDaily } = appConfig.limits.windows;
const DAY_SEC = 24 * 60 * 60;

let demoId: string;

beforeEach(async () => {
  await resetDb();
  resetCircuitBreaker();
  vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] });
  const owner = await prismaClient.user.create({
    data: { id: 'demo-owner', name: 'Demo', email: 'demo@example.com', isSystem: true },
  });
  const demo = await prismaClient.workspace.create({
    data: { userId: owner.id, name: 'Demo', isDemo: true },
  });
  demoId = demo.id;
  await seedSource(demoId, {
    title: 'Security Book',
    chunks: { salt: { content: 'A salt is random data.', vector: vectorOf(1) } },
  });
});

async function guest(email: string) {
  const user = await signedInUser(email);
  await prismaClient.user.update({ where: { id: user.userId }, data: { isGuest: true } });
  return user;
}

async function conversation(user: User) {
  const row = await prismaClient.conversation.create({
    data: { workspaceId: demoId, userId: user.userId, title: 'Demo question' },
  });
  return row.id;
}

function play(primary: StreamTurn[], fallback: StreamTurn[] = [new Error('unused')]) {
  useModels({ [PRIMARY]: streamingModel(primary), [FALLBACK]: streamingModel(fallback) });
}

const ask = async (user: User, id: string, content = 'What is a salt?') =>
  user.agent.post(`/api/v1/conversations/${id}/messages`).send({ content }).buffer(true);

/** Puts the counter of a limit at its points, so the next request is the first one refused. */
async function useUp(name: keyof typeof appConfig.limits.windows, key: string) {
  await consume(name, key);
  const { points } = appConfig.limits.windows[name];
  await prismaClient.rateLimitHit.updateMany({
    where: { key: `${name}:${key}` },
    data: { count: points },
  });
}

const counter = async (name: string) =>
  (await prismaClient.rateLimitHit.findFirstOrThrow({ where: { key: { startsWith: `${name}:` } } }))
    .count;

describe('the 429 of a limit on questions', () => {
  it('names the demo allowance for a guest and says when it resets', async () => {
    play(ANSWER);
    const visitor = await guest('visitor@example.com');
    const id = await conversation(visitor);
    expect((await ask(visitor, id)).status).toBe(200);
    const hit = await prismaClient.rateLimitHit.findFirstOrThrow({
      where: { key: { startsWith: 'guestMessages:' } },
    });
    await prismaClient.rateLimitHit.update({
      where: { key_windowStart: { key: hit.key, windowStart: hit.windowStart } },
      data: { count: guestMessages.points },
    });

    const res = await ask(visitor, id);

    const body = res.body as ErrorBody;
    expect(res.status).toBe(429);
    expect(body).toMatchObject({
      success: false,
      code: 'GUEST_LIMIT',
      message: `The demo allows ${guestMessages.points} questions a day. Sign up to ask more, or come back when it resets.`,
    });
    // Until the day's window ends: the same number in the header and the body.
    const resetsAt = hit.windowStart.getTime() + guestMessages.windowSec * 1000;
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(body.retryAfterSec).toBeLessThanOrEqual(DAY_SEC);
    expect(Math.abs(Date.now() + body.retryAfterSec! * 1000 - resetsAt)).toBeLessThan(2_000);
    expect(res.headers['retry-after']).toBe(String(body.retryAfterSec));
    expect(body).not.toHaveProperty('details');
  });

  it('names the hourly limit', async () => {
    const reader = await signedInUser('reader@example.com');
    const id = await conversation(reader);
    await useUp('messagesHourly', `user:${reader.userId}`);

    const res = await ask(reader, id);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      code: 'HOURLY_LIMIT',
      message: `You can ask ${messagesHourly.points} questions an hour. Try again when the hour is up.`,
    });
    const { retryAfterSec } = res.body as ErrorBody;
    expect(retryAfterSec).toBeGreaterThan(0);
    expect(retryAfterSec).toBeLessThanOrEqual(messagesHourly.windowSec);
    expect(res.headers['retry-after']).toBe(String(retryAfterSec));
  });

  it('names the daily limit', async () => {
    const reader = await signedInUser('reader@example.com');
    const id = await conversation(reader);
    await useUp('messagesDaily', `user:${reader.userId}`);

    const res = await ask(reader, id);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      code: 'DAILY_LIMIT',
      message: `You can ask ${messagesDaily.points} questions a day. Try again tomorrow.`,
    });
    expect((res.body as ErrorBody).retryAfterSec).toBeLessThanOrEqual(messagesDaily.windowSec);
  });

  it("names the day's token budget, which resets at midnight UTC", async () => {
    const reader = await signedInUser('reader@example.com');
    const id = await conversation(reader);
    await prismaClient.usageEvent.create({
      data: {
        userId: reader.userId,
        type: 'LLM',
        task: 'agent',
        provider: 'google',
        model: PRIMARY,
        tokensIn: appConfig.limits.dailyTokensPerUser,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 1,
        ok: true,
      },
    });

    const res = await ask(reader, id);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      code: 'TOKEN_BUDGET',
      message: "You've used up today's model budget. It resets at midnight UTC.",
    });
    const { retryAfterSec } = res.body as ErrorBody;
    expect(retryAfterSec).toBeGreaterThan(0);
    expect(retryAfterSec).toBeLessThanOrEqual(DAY_SEC);
    expect(res.headers['retry-after']).toBe(String(retryAfterSec));
  });

  it('leaves other limits as plain RATE_LIMITED, with the wait in the body too', async () => {
    const reader = await signedInUser('reader@example.com');
    const workspace = await prismaClient.workspace.create({
      data: { userId: reader.userId, name: 'Notes' },
    });
    await useUp('search', `user:${reader.userId}`);

    const res = await reader.agent
      .post(`/api/v1/workspaces/${workspace.id}/search`)
      .send({ query: 'salt', mode: 'keyword' });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED', message: 'Too many requests' });
    expect((res.body as ErrorBody).retryAfterSec).toBeLessThanOrEqual(
      appConfig.limits.windows.search.windowSec,
    );
    expect(res.headers['retry-after']).toBe(String((res.body as ErrorBody).retryAfterSec));
  });
});

describe('a guest whose answer failed', () => {
  it('keeps the question when the models are out of quota', async () => {
    play([apiError(429)], [apiError(429)]);
    const visitor = await guest('visitor@example.com');
    const id = await conversation(visitor);

    const res = await ask(visitor, id);

    expect(res.text).toContain('event: error');
    expect(res.text).toContain('UPSTREAM_ERROR');
    expect(await counter('guestMessages')).toBe(0);
    // The hourly and daily limits still count the attempt.
    expect(await counter('messagesHourly')).toBe(1);

    play(ANSWER);
    expect((await ask(visitor, id)).text).toContain('event: done');
    expect(await counter('guestMessages')).toBe(1);
  });

  it('pays for an answer that worked', async () => {
    play(ANSWER);
    const visitor = await guest('visitor@example.com');

    await ask(visitor, await conversation(visitor));

    expect(await counter('guestMessages')).toBe(1);
  });

  it('gets back a point of the day it was counted in, not of a later one', async () => {
    const evening = Date.parse('2026-10-20T23:59:59Z');
    const morning = evening + 2_000;
    await consume('guestMessages', 'ip:1.2.3.4', evening);
    await consume('guestMessages', 'ip:1.2.3.4', morning);

    await refund('guestMessages', 'ip:1.2.3.4', evening);

    const rows = await prismaClient.rateLimitHit.findMany({
      where: { key: 'guestMessages:ip:1.2.3.4' },
      orderBy: { windowStart: 'asc' },
    });
    expect(rows.map((row) => row.count)).toEqual([0, 1]);

    // Never below zero.
    await refund('guestMessages', 'ip:1.2.3.4', evening);
    expect(
      (await prismaClient.rateLimitHit.findMany({ orderBy: { windowStart: 'asc' } }))[0]!.count,
    ).toBe(0);
  });

  it('is not given back for a signed-up user, who has no guest allowance', async () => {
    play([apiError(429)], [apiError(429)]);
    const reader = await signedInUser('reader@example.com');
    const id = await conversation(reader);

    await ask(reader, id);

    expect(
      await prismaClient.rateLimitHit.count({ where: { key: { startsWith: 'guestMessages:' } } }),
    ).toBe(0);
    expect(await counter('messagesHourly')).toBe(1);
  });
});

describe('GET /usage/me for a guest', () => {
  const usage = async (user: User) => {
    const res = await user.agent.get('/api/v1/usage/me');
    expect(res.status).toBe(200);
    return (
      res.body as { data: { guest: { limit: number; used: number; resetsAt: string } | null } }
    ).data.guest;
  };

  it("shows the demo allowance, what is used of it and when the day's window ends", async () => {
    play(ANSWER);
    const visitor = await guest('visitor@example.com');

    const before = await usage(visitor);
    expect(before).toMatchObject({ limit: guestMessages.points, used: 0 });
    const resetsAt = new Date(before!.resetsAt);
    expect(resetsAt.getTime()).toBeGreaterThan(Date.now());
    expect(resetsAt.getTime() - Date.now()).toBeLessThanOrEqual(DAY_SEC * 1000);
    expect(resetsAt.getTime() % (DAY_SEC * 1000)).toBe(0);

    await ask(visitor, await conversation(visitor));
    expect(await usage(visitor)).toEqual({ ...before, used: 1 });
  });

  it('stops at the limit, though the counter also counts the questions it turned away', async () => {
    play(ANSWER);
    const visitor = await guest('visitor@example.com');
    await ask(visitor, await conversation(visitor));
    await prismaClient.rateLimitHit.updateMany({
      where: { key: { startsWith: 'guestMessages:' } },
      data: { count: guestMessages.points + 3 },
    });

    expect(await usage(visitor)).toMatchObject({
      limit: guestMessages.points,
      used: guestMessages.points,
    });
  });

  it('is null for a signed-up user', async () => {
    expect(await usage(await signedInUser('reader@example.com'))).toBeNull();
  });
});
