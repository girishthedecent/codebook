import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import { noteQuotaError, resetCircuitBreaker } from '../src/llm/circuitBreaker.js';
import { testApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

type User = Awaited<ReturnType<typeof signedInUser>>;

const FROM = '2026-10-01T00:00:00.000Z';
const TO = '2026-10-04T00:00:00.000Z';
const RANGE = `from=${FROM}&to=${TO}`;
const at = (iso: string) => new Date(iso);

let admin: User;
let reader: User;
let readerConversation: string;
let systemId: string;
let systemWorkspace: string;
let systemConversation: string;

beforeEach(async () => {
  await resetDb();
  resetCircuitBreaker();
  admin = await signedInUser('admin@example.com');
  reader = await signedInUser('reader@example.com');
  serverConfig.ADMIN_USER_IDS = [admin.userId];

  const workspace = await prismaClient.workspace.create({
    data: { userId: reader.userId, name: 'Notes' },
  });
  readerConversation = (
    await prismaClient.conversation.create({
      data: { workspaceId: workspace.id, userId: reader.userId, title: 'chat' },
    })
  ).id;

  // The eval runner, which owns a workspace and conversations of its own.
  const system = await prismaClient.user.create({
    data: { id: 'eval-runner', name: 'Eval', email: 'eval@example.com', isSystem: true },
  });
  systemId = system.id;
  systemWorkspace = (
    await prismaClient.workspace.create({ data: { userId: systemId, name: 'eval-core' } })
  ).id;
  systemConversation = (
    await prismaClient.conversation.create({
      data: { workspaceId: systemWorkspace, userId: systemId, title: 'case' },
    })
  ).id;
});

afterEach(() => {
  serverConfig.ADMIN_USER_IDS = [];
});

function usageEvent(createdAt: string, fields: object = {}) {
  return {
    userId: reader.userId,
    type: 'LLM' as const,
    task: 'agent',
    provider: 'google',
    model: 'gemini-3.6-flash',
    tokensIn: 100,
    tokensOut: 10,
    costUsd: '0.001',
    latencyMs: 500,
    ok: true,
    createdAt: at(createdAt),
    ...fields,
  };
}

async function get(path: string, user = admin) {
  const res = await user.agent.get(`/api/v1/monitoring/${path}`);
  expect(res.status, res.text).toBe(200);
  return res.body.data;
}

describe('admin only', () => {
  it.each(['models', 'ingestion-failures', 'rate-limits', 'circuit-breaker'])(
    'answers /monitoring/%s with a plain 404 for anyone else',
    async (name) => {
      const url = `/api/v1/monitoring/${name}`;
      for (const res of [await testApp().get(url), await reader.agent.get(`${url}?limit=abc`)]) {
        expect(res.status).toBe(404);
        expect(res.body.message).toBe(`Route not found: GET ${url}`);
      }
    },
  );
});

describe('system users in the stats', () => {
  async function seedTraffic() {
    await prismaClient.message.createMany({
      data: [
        {
          conversationId: readerConversation,
          role: 'ASSISTANT' as const,
          content: 'a',
          latencyMs: 100,
        },
        {
          conversationId: readerConversation,
          role: 'ASSISTANT' as const,
          content: 'a',
          latencyMs: 300,
        },
        ...Array.from({ length: 3 }, () => ({
          conversationId: systemConversation,
          role: 'ASSISTANT' as const,
          content: 'a',
          status: 'ERROR' as const,
          latencyMs: 9_000,
        })),
      ].map((message) => ({ ...message, createdAt: at('2026-10-02T10:00:00Z') })),
    });
    await prismaClient.usageEvent.createMany({
      data: [
        usageEvent('2026-10-02T10:00:00Z'),
        usageEvent('2026-10-02T10:00:01Z', { userId: systemId, provider: 'groq', ok: false }),
        usageEvent('2026-10-02T10:00:02Z', { userId: systemId, provider: 'groq' }),
        // An embedding for an ingest has no user at all: it is nobody's system traffic.
        usageEvent('2026-10-02T10:00:03Z', { userId: null, type: 'EMBEDDING' }),
      ],
    });
    await prismaClient.source.createMany({
      data: [
        {
          workspaceId: systemWorkspace,
          type: 'WEBSITE',
          title: 'corpus page',
          dedupeKey: 'corpus',
          origin: {},
          status: 'FAILED',
          createdAt: at('2026-10-02T09:00:00Z'),
        },
      ],
    });
  }

  it('leaves them out of answers, usage, providers and ingestion unless asked', async () => {
    await seedTraffic();

    const real = await get(`stats?${RANGE}`);
    expect(real.answers.count).toBe(2);
    expect(real.answers.errorRate).toBe(0);
    expect(real.answers.latencyMs.p50).toBe(200);
    expect(real.usagePerDay[1]).toMatchObject({ day: '2026-10-02', calls: 2 });
    expect(real.providers.byProvider.map((p: { provider: string }) => p.provider)).toEqual([
      'google',
    ]);
    expect(real.ingestion).toMatchObject({ failed: 0, inProgress: 0 });

    const all = await get(`stats?${RANGE}&includeSystem=true`);
    expect(all.answers.count).toBe(5);
    expect(all.answers.errorRate).toBe(0.6);
    expect(all.usagePerDay[1]).toMatchObject({ day: '2026-10-02', calls: 4 });
    expect(all.providers.byProvider.map((p: { provider: string }) => p.provider)).toEqual([
      'google',
      'groq',
    ]);
    expect(all.ingestion.failed).toBe(1);
  });

  it('takes the flag as true or false only', async () => {
    const res = await admin.agent.get(`/api/v1/monitoring/stats?${RANGE}&includeSystem=maybe`);
    expect(res.status).toBe(400);
  });
});

describe('GET /monitoring/models', () => {
  it('sums calls, failures, fallbacks, tokens and cost per model and key, and per task', async () => {
    // "backup" is what rows written before keys were numbered call the second Gemini key.
    await prismaClient.usageEvent.createMany({
      data: [
        usageEvent('2026-10-01T10:00:00Z'),
        usageEvent('2026-10-01T10:00:01Z', {
          ok: false,
          error: 'quota',
          tokensIn: 0,
          tokensOut: 0,
        }),
        usageEvent('2026-10-01T10:00:02Z', { key: 'backup', fallbackUsed: true, costUsd: '0.002' }),
        usageEvent('2026-10-01T10:00:02.500Z', { key: '2' }),
        usageEvent('2026-10-01T10:00:03Z', {
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          task: 'cheap',
          fallbackUsed: true,
          costUsd: '0',
        }),
        usageEvent('2026-10-01T10:00:04Z', {
          type: 'EMBEDDING',
          provider: 'google',
          model: 'gemini-embedding-2',
          task: 'embed',
          tokensOut: 0,
        }),
        // Outside the range, and by the eval runner.
        usageEvent('2026-09-30T23:59:59Z'),
        usageEvent('2026-10-01T10:00:05Z', { userId: systemId }),
      ],
    });

    const { from, to, models, tasks } = await get(`models?${RANGE}`);

    expect([from, to]).toEqual([FROM, TO]);
    expect(models).toEqual([
      {
        type: 'LLM',
        provider: 'google',
        model: 'gemini-3.6-flash',
        key: '2',
        calls: 2,
        errors: 0,
        fallbacks: 1,
        tokensIn: 200,
        tokensOut: 20,
        costUsd: '0.003',
      },
      {
        type: 'LLM',
        provider: 'google',
        model: 'gemini-3.6-flash',
        key: null,
        calls: 2,
        errors: 1,
        fallbacks: 0,
        tokensIn: 100,
        tokensOut: 10,
        costUsd: '0.002',
      },
      {
        type: 'EMBEDDING',
        provider: 'google',
        model: 'gemini-embedding-2',
        key: null,
        calls: 1,
        errors: 0,
        fallbacks: 0,
        tokensIn: 100,
        tokensOut: 0,
        costUsd: '0.001',
      },
      {
        type: 'LLM',
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        key: null,
        calls: 1,
        errors: 0,
        fallbacks: 1,
        tokensIn: 100,
        tokensOut: 10,
        costUsd: '0',
      },
    ]);
    expect(tasks).toEqual([
      expect.objectContaining({ task: 'agent', calls: 4, errors: 1, fallbacks: 1, tokensIn: 300 }),
      expect.objectContaining({ task: 'cheap', calls: 1, fallbacks: 1 }),
      expect.objectContaining({ task: 'embed', calls: 1 }),
    ]);

    const withSystem = await get(`models?${RANGE}&includeSystem=true`);
    expect(withSystem.models[0]).toMatchObject({ model: 'gemini-3.6-flash', key: null, calls: 3 });
  });

  it('is empty without calls', async () => {
    expect(await get(`models?${RANGE}`)).toMatchObject({ models: [], tasks: [] });
  });
});

describe('GET /monitoring/ingestion-failures', () => {
  async function failed(title: string, updatedAt: string, fields: object = {}) {
    const workspace = await prismaClient.workspace.findFirstOrThrow({
      where: { userId: reader.userId },
    });
    const source = await prismaClient.source.create({
      data: {
        workspaceId: workspace.id,
        type: 'GITHUB_REPO',
        title,
        dedupeKey: title,
        origin: {},
        status: 'FAILED',
        stage: 'PARSING',
        error: 'The repository is larger than 200 MB',
        updatedAt: at(updatedAt),
        ...fields,
      },
    });
    return source;
  }

  it('lists failed sources, latest first, with what the owner saw', async () => {
    const older = await failed('acme/old', '2026-10-01T10:00:00Z');
    const newer = await failed('acme/new', '2026-10-02T10:00:00Z', {
      type: 'WEBSITE',
      stage: 'FETCHING',
      error: 'The page could not be fetched',
    });
    await failed('acme/fine', '2026-10-03T10:00:00Z', { status: 'READY', error: null });

    const items = await get('ingestion-failures');

    expect(items).toEqual([
      {
        sourceId: newer.id,
        workspaceId: newer.workspaceId,
        userId: reader.userId,
        title: 'acme/new',
        type: 'WEBSITE',
        stage: 'FETCHING',
        error: 'The page could not be fetched',
        failedAt: '2026-10-02T10:00:00.000Z',
      },
      expect.objectContaining({
        sourceId: older.id,
        title: 'acme/old',
        type: 'GITHUB_REPO',
        stage: 'PARSING',
        error: 'The repository is larger than 200 MB',
        failedAt: '2026-10-01T10:00:00.000Z',
      }),
    ]);
  });

  it('caps the list, and leaves out the eval corpus unless asked', async () => {
    for (let i = 0; i < 3; i++) await failed(`acme/${i}`, `2026-10-0${i + 1}T10:00:00Z`);
    await prismaClient.source.create({
      data: {
        workspaceId: systemWorkspace,
        type: 'WEBSITE',
        title: 'corpus page',
        dedupeKey: 'corpus',
        origin: {},
        status: 'FAILED',
      },
    });

    expect(
      (await get('ingestion-failures?limit=2')).map((s: { title: string }) => s.title),
    ).toEqual(['acme/2', 'acme/1']);
    expect(await get('ingestion-failures')).toHaveLength(3);
    const all = await get('ingestion-failures?includeSystem=true');
    expect(all).toHaveLength(4);
    expect(all[0]).toMatchObject({ title: 'corpus page', userId: systemId });
    expect((await admin.agent.get('/api/v1/monitoring/ingestion-failures?limit=0')).status).toBe(
      400,
    );
  });
});

describe('GET /monitoring/rate-limits', () => {
  const hit = (key: string, windowStart: string, count: number) =>
    prismaClient.rateLimitHit.create({ data: { key, windowStart: at(windowStart), count } });

  it('shows each limit with what it counted, turned away and who was turned away', async () => {
    const { guestMessages, messagesHourly } = appConfig.limits.windows;
    await hit('guestMessages:ip:1.1.1.1', '2026-10-02T00:00:00Z', guestMessages.points + 4);
    await hit('guestMessages:ip:2.2.2.2', '2026-10-02T00:00:00Z', guestMessages.points + 1);
    await hit('guestMessages:ip:2.2.2.2', '2026-10-03T00:00:00Z', 2);
    // At the limit is still allowed.
    await hit('messagesHourly:user:a', '2026-10-02T10:00:00Z', messagesHourly.points);
    // Outside the range.
    await hit('guestMessages:ip:3.3.3.3', '2026-09-30T00:00:00Z', 99);

    const { from, to, limits } = await get(`rate-limits?${RANGE}`);

    expect([from, to]).toEqual([FROM, TO]);
    const byName = Object.fromEntries(limits.map((l: { name: string }) => [l.name, l]));
    expect(byName.guestMessages).toEqual({
      name: 'guestMessages',
      points: guestMessages.points,
      windowSec: guestMessages.windowSec,
      requests: guestMessages.points * 2 + 7,
      blocked: 5,
      clientsBlocked: 2,
    });
    expect(byName.messagesHourly).toMatchObject({
      requests: messagesHourly.points,
      blocked: 0,
      clientsBlocked: 0,
    });
    // Every limit is listed, used or not; a monthly one has no window length.
    expect(limits.map((l: { name: string }) => l.name).sort()).toEqual(
      Object.keys(appConfig.limits.windows).sort(),
    );
    expect(byName.webSearchMonthly).toMatchObject({ windowSec: null, requests: 0 });
  });
});

describe('GET /monitoring/circuit-breaker', () => {
  const flash = { provider: 'google', model: 'gemini-3.6-flash' } as const;

  it('lists every model with whether it is being skipped', async () => {
    const { quotaErrors, windowMs, coolOffMs } = appConfig.circuitBreaker;
    for (let i = 0; i < quotaErrors; i++) noteQuotaError(flash);
    noteQuotaError({ provider: 'groq', model: 'openai/gpt-oss-120b' });

    const before = Date.now();
    const state = await get('circuit-breaker');

    expect(state).toMatchObject({ quotaErrors, windowMs, coolOffMs });
    const byModel = Object.fromEntries(state.models.map((m: { model: string }) => [m.model, m]));
    expect(byModel['google/gemini-3.6-flash']).toMatchObject({ open: true, recentQuotaErrors: 0 });
    const openUntil = Date.parse(byModel['google/gemini-3.6-flash'].openUntil);
    expect(openUntil).toBeGreaterThanOrEqual(before + coolOffMs - 5_000);
    expect(openUntil).toBeLessThanOrEqual(Date.now() + coolOffMs);
    // One error is not enough to open it.
    expect(byModel['groq/openai/gpt-oss-120b']).toEqual({
      model: 'groq/openai/gpt-oss-120b',
      open: false,
      openUntil: null,
      recentQuotaErrors: 1,
    });
    // A model that never failed is listed too.
    expect(byModel['groq/openai/gpt-oss-20b']).toEqual({
      model: 'groq/openai/gpt-oss-20b',
      open: false,
      openUntil: null,
      recentQuotaErrors: 0,
    });
    expect(byModel['google/gemini-embedding-2']).toMatchObject({ open: false });
  });

  it('lists each model once for every key', async () => {
    const keys = serverConfig.GEMINI_API_KEYS;
    serverConfig.GEMINI_API_KEYS = ['first', 'second', 'third'];
    try {
      const labels = (await get('circuit-breaker')).models.map((m: { model: string }) => m.model);
      for (const model of ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-embedding-2']) {
        expect(labels.filter((label: string) => label.startsWith(`google/${model}`))).toEqual([
          `google/${model}`,
          `google/${model}#2`,
          `google/${model}#3`,
        ]);
      }
      expect(labels).not.toContain('groq/openai/gpt-oss-120b#2');
    } finally {
      serverConfig.GEMINI_API_KEYS = keys;
    }
  });

  it('starts with every model closed', async () => {
    const { models } = await get('circuit-breaker');
    expect(models.length).toBeGreaterThan(3);
    expect(models.every((m: { open: boolean }) => !m.open)).toBe(true);
  });
});
