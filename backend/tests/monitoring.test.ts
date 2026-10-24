import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import { testApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

type User = Awaited<ReturnType<typeof signedInUser>>;

const FROM = '2026-10-01T00:00:00.000Z';
const TO = '2026-10-04T00:00:00.000Z';
const at = (iso: string) => new Date(iso);

let admin: User;
let reader: User;
let conversationId: string;

beforeEach(async () => {
  await resetDb();
  admin = await signedInUser('admin@example.com');
  reader = await signedInUser('reader@example.com');
  serverConfig.ADMIN_USER_IDS = [admin.userId];

  const workspace = await prismaClient.workspace.create({
    data: { userId: reader.userId, name: 'Notes' },
  });
  const conversation = await prismaClient.conversation.create({
    data: { workspaceId: workspace.id, userId: reader.userId, title: 'chat' },
  });
  conversationId = conversation.id;
});

afterEach(() => {
  serverConfig.ADMIN_USER_IDS = [];
});

function answer(createdAt: string, fields: object = {}) {
  return {
    conversationId,
    role: 'ASSISTANT' as const,
    content: 'an answer',
    createdAt: at(createdAt),
    ...fields,
  };
}

function usageEvent(createdAt: string, fields: object = {}) {
  return {
    userId: reader.userId,
    type: 'LLM' as const,
    task: 'chat',
    provider: 'groq',
    model: 'llama',
    tokensIn: 100,
    tokensOut: 10,
    costUsd: '0.001',
    latencyMs: 500,
    ok: true,
    createdAt: at(createdAt),
    ...fields,
  };
}

describe('admin only', () => {
  it.each(['/api/v1/monitoring/stats', '/api/v1/monitoring/failed-queries'])(
    'answers %s with a plain 404 for anyone else',
    async (url) => {
      const anonymous = await testApp().get(url);
      const signedIn = await reader.agent.get(url);
      // A bad query string still gets the 404, not a validation error.
      const badQuery = await reader.agent.get(`${url}?limit=abc&from=nope`);
      const missing = await reader.agent.get('/api/v1/no-such-route');

      expect(missing.body.message).toBe('Route not found: GET /api/v1/no-such-route');
      for (const res of [anonymous, signedIn, badQuery]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(missing.body.code);
        expect(res.body.message).toBe(`Route not found: GET ${url}`);
      }
    },
  );

  it('lets admins in', async () => {
    const res = await admin.agent.get('/api/v1/monitoring/stats');
    expect(res.status).toBe(200);
  });
});

describe('GET /monitoring/stats', () => {
  const stats = async (query = `from=${FROM}&to=${TO}`) => {
    const res = await admin.agent.get(`/api/v1/monitoring/stats?${query}`);
    expect(res.status).toBe(200);
    return res.body.data;
  };

  it('computes latency percentiles and quality rates over answers in range', async () => {
    await prismaClient.message.createMany({
      data: [
        answer('2026-10-01T10:00:00Z', {
          latencyMs: 100,
          firstTokenMs: 10,
          retrievalMs: 50,
          feedback: 'UP',
        }),
        answer('2026-10-01T11:00:00Z', {
          latencyMs: 200,
          firstTokenMs: 20,
          retrievalMs: 60,
          feedback: 'DOWN',
          invalidCitations: 2,
        }),
        answer('2026-10-02T10:00:00Z', { latencyMs: 300, retrievalMs: 70, weakRetrieval: true }),
        // Errored before any token: no latency numbers, still counted.
        answer('2026-10-02T11:00:00Z', { status: 'ERROR', error: 'provider down' }),
        answer('2026-10-03T10:00:00Z', { latencyMs: 400, firstTokenMs: 40, retrievalMs: 90 }),
        // Questions and answers outside the range don't count.
        { conversationId, role: 'USER' as const, content: 'q', createdAt: at(FROM) },
        answer('2026-09-30T23:59:59Z', { latencyMs: 9000, feedback: 'DOWN' }),
        answer(TO, { latencyMs: 9000, feedback: 'DOWN' }),
      ],
    });

    const { answers } = await stats();
    expect(answers.count).toBe(5);
    // percentile_cont interpolates: [100, 200, 300, 400].
    expect(answers.latencyMs).toEqual({ p50: 250, p95: 385 });
    // [10, 20, 40]
    expect(answers.firstTokenMs).toEqual({ p50: 20, p95: 38 });
    // [50, 60, 70, 90]
    expect(answers.retrievalMs).toEqual({ p50: 65, p95: 87 });
    expect(answers.errorRate).toBe(0.2);
    // One of the two rated answers.
    expect(answers.thumbsDownRate).toBe(0.5);
    expect(answers.invalidCitationRate).toBe(0.2);
    expect(answers.weakRetrievalRate).toBe(0.2);
  });

  it('buckets usage per UTC day, empty days included', async () => {
    await prismaClient.usageEvent.createMany({
      data: [
        usageEvent('2026-10-01T00:00:00Z'),
        usageEvent('2026-10-01T23:59:59Z', { tokensIn: 50, tokensOut: 5, costUsd: '0.0005' }),
        usageEvent('2026-10-03T08:00:00Z', { type: 'EMBEDDING', tokensOut: 0, costUsd: '0.0002' }),
        usageEvent('2026-09-30T23:59:59Z'),
        usageEvent(TO),
      ],
    });

    const { usagePerDay } = await stats();
    expect(usagePerDay).toEqual([
      { day: '2026-10-01', calls: 2, tokensIn: 150, tokensOut: 15, costUsd: '0.0015' },
      { day: '2026-10-02', calls: 0, tokensIn: 0, tokensOut: 0, costUsd: '0' },
      { day: '2026-10-03', calls: 1, tokensIn: 100, tokensOut: 0, costUsd: '0.0002' },
    ]);
  });

  it('clips the first and last day to the range', async () => {
    await prismaClient.usageEvent.createMany({
      data: [usageEvent('2026-10-01T06:00:00Z'), usageEvent('2026-10-01T18:00:00Z')],
    });

    const { usagePerDay } = await stats('from=2026-10-01T12:00:00Z&to=2026-10-02T12:00:00Z');
    expect(usagePerDay.map((day: { day: string; calls: number }) => [day.day, day.calls])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 0],
    ]);
  });

  it('reports fallback and provider error rates', async () => {
    await prismaClient.usageEvent.createMany({
      data: [
        usageEvent('2026-10-01T10:00:00Z'),
        usageEvent('2026-10-01T10:00:01Z', { ok: false, error: 'timeout' }),
        usageEvent('2026-10-01T10:00:02Z', { provider: 'gemini', fallbackUsed: true }),
        usageEvent('2026-10-01T10:00:03Z', { provider: 'gemini', type: 'EMBEDDING' }),
      ],
    });

    const { providers } = await stats();
    expect(providers.errorRate).toBe(0.25);
    // One of three model calls; embeddings have no fallback.
    expect(providers.fallbackRate).toBe(0.3333);
    expect(providers.byProvider).toEqual([
      { provider: 'gemini', calls: 2, errorRate: 0, fallbackRate: 1 },
      { provider: 'groq', calls: 2, errorRate: 0.5, fallbackRate: 0 },
    ]);
  });

  it('reports ingestion success and rough duration', async () => {
    const workspace = await prismaClient.workspace.findFirstOrThrow();
    const source = (key: string, createdAt: string, fields: object) => ({
      workspaceId: workspace.id,
      type: 'WEBSITE' as const,
      title: key,
      dedupeKey: key,
      origin: {},
      createdAt: at(createdAt),
      ...fields,
    });
    await prismaClient.source.createMany({
      data: [
        source('a', '2026-10-01T10:00:00Z', {
          status: 'READY',
          lastIngestedAt: at('2026-10-01T10:01:00Z'),
        }),
        source('b', '2026-10-02T10:00:00Z', {
          status: 'READY',
          lastIngestedAt: at('2026-10-02T10:02:00Z'),
        }),
        source('c', '2026-10-02T11:00:00Z', { status: 'FAILED' }),
        source('d', '2026-10-03T11:00:00Z', { status: 'PROCESSING' }),
        source('e', '2026-09-20T11:00:00Z', { status: 'FAILED' }),
      ],
    });

    const { ingestion } = await stats();
    expect(ingestion).toEqual({
      ready: 2,
      failed: 1,
      inProgress: 1,
      successRate: 0.6667,
      avgSeconds: 90,
    });
  });

  it('returns nulls, not zeros, when there is nothing to measure', async () => {
    const data = await stats();
    expect(data.answers.latencyMs).toEqual({ p50: null, p95: null });
    expect(data.answers.errorRate).toBeNull();
    expect(data.providers.fallbackRate).toBeNull();
    expect(data.ingestion.successRate).toBeNull();
  });

  it('defaults to the last 7 days', async () => {
    const data = await stats('');
    const span = new Date(data.to).getTime() - new Date(data.from).getTime();
    expect(span).toBe(7 * 24 * 60 * 60 * 1000);
    expect(data.usagePerDay.length).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['a range over 90 days', 'from=2026-01-01T00:00:00Z&to=2026-10-01T00:00:00Z'],
    ['from after to', `from=${TO}&to=${FROM}`],
    ['a date that is not ISO', 'from=yesterday'],
  ])('rejects %s', async (_name, query) => {
    const res = await admin.agent.get(`/api/v1/monitoring/stats?${query}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /monitoring/failed-queries', () => {
  it('lists bad answers with their question and reasons, newest first, page by page', async () => {
    const question = (content: string, createdAt: string) => ({
      conversationId,
      role: 'USER' as const,
      content,
      createdAt: at(createdAt),
    });
    await prismaClient.message.createMany({
      data: [
        question('first?', '2026-10-01T10:00:00Z'),
        answer('2026-10-01T10:00:05Z', { feedback: 'DOWN', feedbackNote: 'wrong page' }),
        question('second?', '2026-10-01T11:00:00Z'),
        answer('2026-10-01T11:00:05Z', { feedback: 'UP' }),
        question('third?', '2026-10-01T12:00:00Z'),
        answer('2026-10-01T12:00:05Z', {
          status: 'ERROR',
          error: 'provider down',
          weakRetrieval: true,
        }),
        question('fourth?', '2026-10-01T13:00:00Z'),
        answer('2026-10-01T13:00:05Z', { content: 'x'.repeat(1000), invalidCitations: 2 }),
      ],
    });

    const first = await admin.agent.get('/api/v1/monitoring/failed-queries?limit=2');
    expect(first.status).toBe(200);
    const page1 = first.body.data;
    expect(page1.items.map((item: { question: string }) => item.question)).toEqual([
      'fourth?',
      'third?',
    ]);
    expect(page1.items[0]).toMatchObject({
      reasons: ['invalid_citations'],
      invalidCitations: 2,
      userId: reader.userId,
    });
    expect(page1.items[0].answerExcerpt).toHaveLength(300);
    expect(page1.items[1]).toMatchObject({
      reasons: ['error', 'weak_retrieval'],
      error: 'provider down',
    });
    expect(page1.nextCursor).toEqual(expect.any(String));

    const second = await admin.agent.get(
      `/api/v1/monitoring/failed-queries?limit=2&cursor=${page1.nextCursor}`,
    );
    const page2 = second.body.data;
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]).toMatchObject({
      question: 'first?',
      reasons: ['thumbs_down'],
      feedbackNote: 'wrong page',
    });
    expect(page2.nextCursor).toBeNull();
  });

  it('rejects a cursor it did not issue', async () => {
    const res = await admin.agent.get('/api/v1/monitoring/failed-queries?cursor=garbage');
    expect(res.status).toBe(400);
  });
});
