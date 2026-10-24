import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { myUsageService } from '../src/modules/usage/usage.service.js';
import { testApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

const NOW = new Date('2026-10-20T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);
const daysAgo = (days: number) => hoursAgo(days * 24);

type User = Awaited<ReturnType<typeof signedInUser>>;

// For tests that don't read the message limits.
const ANY_LIMIT_KEY = 'user:unused';

let alice: User;
let workspaceId: string;

beforeEach(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  const workspace = await prismaClient.workspace.create({
    data: { userId: alice.userId, name: 'Notes' },
  });
  workspaceId = workspace.id;
});

async function seedQuestions(userId: string, wsId: string, dates: Date[]) {
  const conversation = await prismaClient.conversation.create({
    data: { workspaceId: wsId, userId, title: 'chat' },
  });
  await prismaClient.message.createMany({
    data: dates.flatMap((createdAt) => [
      { conversationId: conversation.id, role: 'USER' as const, content: 'q', createdAt },
      { conversationId: conversation.id, role: 'ASSISTANT' as const, content: 'a', createdAt },
    ]),
  });
}

function usageEvent(userId: string, createdAt: Date, fields: object = {}) {
  return {
    userId,
    type: 'LLM' as const,
    task: 'chat',
    provider: 'groq',
    model: 'llama',
    tokensIn: 100,
    tokensOut: 10,
    costUsd: '0.001',
    latencyMs: 500,
    ok: true,
    createdAt,
    ...fields,
  };
}

describe('GET /usage/me', () => {
  it('needs a session', async () => {
    const res = await testApp().get('/api/v1/usage/me');
    expect(res.status).toBe(401);
  });

  it('returns the windows, totals and limits', async () => {
    const res = await alice.agent.get('/api/v1/usage/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      today: { messages: 0, tokensIn: 0, tokensOut: 0, costUsd: '0' },
      sources: 0,
      storage: { pdfBytes: 0, limitBytes: appConfig.limits.pdfStorageBytesPerUser },
      limits: {
        messagesToday: {
          limit: appConfig.limits.windows.messagesDaily.points,
          remaining: appConfig.limits.windows.messagesDaily.points,
        },
      },
    });
  });
});

describe('myUsageService', () => {
  it('counts messages and model usage per window', async () => {
    // Today (UTC), 3 days ago, 20 days ago, and 40 days ago (outside every window).
    await seedQuestions(alice.userId, workspaceId, [
      hoursAgo(1),
      hoursAgo(2),
      daysAgo(3),
      daysAgo(20),
      daysAgo(40),
    ]);
    await prismaClient.usageEvent.createMany({
      data: [
        usageEvent(alice.userId, hoursAgo(1)),
        usageEvent(alice.userId, hoursAgo(2), { tokensIn: 50, tokensOut: 5, costUsd: '0.0005' }),
        // Embeddings cost money but their tokens aren't LLM tokens.
        usageEvent(alice.userId, hoursAgo(2), {
          type: 'EMBEDDING',
          tokensIn: 999,
          tokensOut: 0,
          costUsd: '0.0002',
        }),
        usageEvent(alice.userId, daysAgo(3)),
        usageEvent(alice.userId, daysAgo(20)),
        usageEvent(alice.userId, daysAgo(40)),
      ],
    });

    // Someone else's usage never shows up.
    const bob = await signedInUser('bob@example.com');
    const bobWorkspace = await prismaClient.workspace.create({
      data: { userId: bob.userId, name: 'Bob' },
    });
    await seedQuestions(bob.userId, bobWorkspace.id, [hoursAgo(1)]);
    await prismaClient.usageEvent.create({ data: usageEvent(bob.userId, hoursAgo(1)) });

    const usage = await myUsageService(alice.userId, ANY_LIMIT_KEY, NOW.getTime());
    expect(usage.today).toEqual({
      messages: 2,
      tokensIn: 150,
      tokensOut: 15,
      costUsd: '0.0017',
    });
    expect(usage.last7Days).toEqual({
      messages: 3,
      tokensIn: 250,
      tokensOut: 25,
      costUsd: '0.0027',
    });
    expect(usage.last30Days).toEqual({
      messages: 4,
      tokensIn: 350,
      tokensOut: 35,
      costUsd: '0.0037',
    });
    expect(usage.limits.tokensToday.remaining).toBe(appConfig.limits.dailyTokensPerUser - 165);
  });

  it('starts "today" at UTC midnight', async () => {
    // 12:00 UTC now, so 13 hours ago was yesterday.
    await seedQuestions(alice.userId, workspaceId, [hoursAgo(11), hoursAgo(13)]);
    const usage = await myUsageService(alice.userId, ANY_LIMIT_KEY, NOW.getTime());
    expect(usage.today.messages).toBe(1);
    expect(usage.last7Days.messages).toBe(2);
  });

  it('sums sources and PDF bytes across the user’s workspaces', async () => {
    const other = await prismaClient.workspace.create({
      data: { userId: alice.userId, name: 'Other' },
    });
    await prismaClient.source.createMany({
      data: [
        {
          workspaceId,
          type: 'PDF',
          title: 'a.pdf',
          dedupeKey: 'a',
          origin: { storageKey: 'k1', fileName: 'a.pdf', size: 1000, mime: 'application/pdf' },
        },
        {
          workspaceId: other.id,
          type: 'PDF',
          title: 'b.pdf',
          dedupeKey: 'b',
          origin: { storageKey: 'k2', fileName: 'b.pdf', size: 2500, mime: 'application/pdf' },
        },
        {
          workspaceId,
          type: 'WEBSITE',
          title: 'site',
          dedupeKey: 'c',
          origin: { url: 'https://example.com', maxDepth: 1, maxPages: 5 },
        },
      ],
    });

    const usage = await myUsageService(alice.userId, ANY_LIMIT_KEY, NOW.getTime());
    expect(usage.sources).toBe(3);
    expect(usage.storage.pdfBytes).toBe(3500);
  });
});

describe('message limits', () => {
  const MISSING_ID = 'cjld2cjxh0000qzrmn831i7rn';

  // The chat route counts both limits before it looks the conversation up, so a message to
  // a conversation that doesn't exist uses one of each without calling a model.
  async function sendMessage(user: User) {
    const res = await user.agent
      .post(`/api/v1/conversations/${MISSING_ID}/messages`)
      .send({ content: 'hello' });
    expect(res.status).toBe(404);
  }

  async function messageLimits(user: User) {
    const res = await user.agent.get('/api/v1/usage/me');
    expect(res.status).toBe(200);
    return res.body.data.limits as Record<
      'messagesToday' | 'messagesThisHour',
      { limit: number; remaining: number }
    >;
  }

  it('reads what the chat route has counted for the user', async () => {
    const bob = await signedInUser('bob@example.com');
    await sendMessage(alice);
    await sendMessage(alice);
    await sendMessage(bob);

    const { messagesDaily, messagesHourly } = appConfig.limits.windows;
    const limits = await messageLimits(alice);
    expect(limits.messagesToday).toEqual({
      limit: messagesDaily.points,
      remaining: messagesDaily.points - 2,
    });
    expect(limits.messagesThisHour).toEqual({
      limit: messagesHourly.points,
      remaining: messagesHourly.points - 2,
    });
  });

  it('counts guests by IP, like the limiter does', async () => {
    const guest = await signedInUser('guest@example.com');
    const nextGuest = await signedInUser('guest2@example.com');
    await prismaClient.user.updateMany({
      where: { id: { in: [guest.userId, nextGuest.userId] } },
      data: { isGuest: true },
    });
    await sendMessage(guest);

    const { messagesDaily } = appConfig.limits.windows;
    // A new guest account from the same address starts where the last one left off.
    expect((await messageLimits(nextGuest)).messagesToday.remaining).toBe(messagesDaily.points - 1);
    // Alice's count is her own, not the address's.
    expect((await messageLimits(alice)).messagesToday.remaining).toBe(messagesDaily.points);
  });
});
