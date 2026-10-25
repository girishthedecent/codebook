import { InngestTestEngine } from '@inngest/test';
import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { cleanupGuests, deleteGuestBatch } from '../src/modules/demo/guestCleanup.function.js';
import { resetDb } from './helpers/db.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const OLD = appConfig.demo.guestTtlDays + 1;

let workspaceId: string;

beforeEach(async () => {
  await resetDb();
  const owner = await prismaClient.user.create({
    data: { id: 'demo-owner', name: 'Demo', email: 'demo@example.com', isSystem: true },
  });
  workspaceId = (
    await prismaClient.workspace.create({ data: { userId: owner.id, name: 'Demo', isDemo: true } })
  ).id;
});

/** A user with a session, a demo conversation with one exchange, and a usage row. */
async function userWith(id: string, { isGuest = true, ageDays = OLD } = {}) {
  const createdAt = daysAgo(ageDays);
  await prismaClient.user.create({
    data: { id, name: id, email: `${id}@example.com`, isGuest, createdAt },
  });
  await prismaClient.session.create({
    data: { id: `${id}-session`, token: `${id}-token`, userId: id, expiresAt: daysAgo(-1) },
  });
  const conversation = await prismaClient.conversation.create({
    data: { workspaceId, userId: id, title: 'Question' },
  });
  await prismaClient.message.createMany({
    data: [
      { conversationId: conversation.id, role: 'USER', content: 'What is a salt?' },
      { conversationId: conversation.id, role: 'ASSISTANT', content: 'Random data [1].' },
    ],
  });
  await prismaClient.usageEvent.create({
    data: {
      userId: id,
      workspaceId,
      type: 'LLM',
      task: 'agent',
      provider: 'google',
      model: 'model',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0,
      latencyMs: 100,
      ok: true,
    },
  });
}

const userIds = async () =>
  (await prismaClient.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(
    (user) => user.id,
  );

describe('guest cleanup', () => {
  it('deletes old guests with what they made, and keeps everyone else', async () => {
    await userWith('old-guest');
    await userWith('new-guest', { ageDays: 1 });
    await userWith('old-reader', { isGuest: false });
    await prismaClient.answerCache.createMany({
      data: [
        {
          key: 'stale',
          workspaceId,
          content: 'a',
          citations: [],
          promptId: 'p',
          createdAt: daysAgo(2),
        },
        { key: 'fresh', workspaceId, content: 'b', citations: [], promptId: 'p' },
      ],
    });

    const engine = new InngestTestEngine({ function: cleanupGuests });
    const { result } = await engine.execute();

    expect(result).toEqual({ guests: 1, answers: 1 });
    expect(await userIds()).toEqual(['demo-owner', 'new-guest', 'old-reader']);
    expect(await prismaClient.session.count({ where: { userId: 'old-guest' } })).toBe(0);
    expect(await prismaClient.conversation.count({ where: { userId: 'old-guest' } })).toBe(0);
    expect(await prismaClient.message.count()).toBe(4);
    // The cost totals keep the guest's calls, without saying whose they were.
    const usage = await prismaClient.usageEvent.findMany({ orderBy: { userId: 'asc' } });
    expect(usage.map((row) => row.userId)).toEqual(['new-guest', 'old-reader', null]);
    expect((await prismaClient.answerCache.findMany()).map((row) => row.key)).toEqual(['fresh']);
  });

  it('deletes in batches, oldest first', async () => {
    await userWith('guest-a', { ageDays: OLD + 2 });
    await userWith('guest-b', { ageDays: OLD + 1 });
    await userWith('guest-c', { ageDays: OLD });

    const cutoff = daysAgo(appConfig.demo.guestTtlDays);
    expect(await deleteGuestBatch(cutoff, 2)).toBe(2);
    expect(await userIds()).toEqual(['demo-owner', 'guest-c']);
    expect(await deleteGuestBatch(cutoff, 2)).toBe(1);
    expect(await deleteGuestBatch(cutoff, 2)).toBe(0);
  });

  it('never deletes a system user flagged as a guest', async () => {
    await prismaClient.user.update({
      where: { id: 'demo-owner' },
      data: { isGuest: true, createdAt: daysAgo(OLD) },
    });
    expect(await deleteGuestBatch(daysAgo(appConfig.demo.guestTtlDays))).toBe(0);
    expect(await prismaClient.workspace.count()).toBe(1);
  });
});
