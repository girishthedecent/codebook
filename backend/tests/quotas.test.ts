import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { TooManyRequestsError } from '../src/utils/errors/app.error.js';
import {
  assertPdfStorage,
  assertTokenBudget,
  pdfBytesUsed,
  tokensUsedToday,
} from '../src/utils/quotas.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { minimalPdf } from './helpers/pdf.js';

const MB = 1024 * 1024;

let alice: Awaited<ReturnType<typeof signedInUser>>;
let workspaceId: string;

beforeEach(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Books' });
  workspaceId = (res.body as { data: { id: string } }).data.id;
});

async function seedPdf(size: number, inWorkspace = workspaceId) {
  await prismaClient.source.create({
    data: {
      workspaceId: inWorkspace,
      type: 'PDF',
      title: `book ${size}`,
      origin: { storageKey: null, fileName: 'book.pdf', size, mime: 'application/pdf' },
      dedupeKey: `pdf:${size}:${Math.random()}`,
    },
  });
}

describe('PDF storage', () => {
  it('adds up PDF sizes across all of the user’s workspaces, and nobody else’s', async () => {
    const other = await prismaClient.workspace.create({
      data: { userId: alice.userId, name: 'More' },
    });
    const bob = await signedInUser('bob@example.com');
    const bobs = await prismaClient.workspace.create({ data: { userId: bob.userId, name: 'Bob' } });
    await seedPdf(10 * MB);
    await seedPdf(5 * MB, other.id);
    await seedPdf(99 * MB, bobs.id);

    expect(await pdfBytesUsed(alice.userId)).toBe(15 * MB);
  });

  it('refuses an upload that would pass the limit', async () => {
    const limit = appConfig.limits.pdfStorageBytesPerUser;
    await seedPdf(limit - MB);

    await expect(assertPdfStorage(alice.userId, MB)).resolves.toBeUndefined();
    await expect(assertPdfStorage(alice.userId, MB + 1)).rejects.toThrow(/PDF storage/);
  });

  it('answers the upload with a 409 before storing anything', async () => {
    await seedPdf(appConfig.limits.pdfStorageBytesPerUser);

    const res = await alice.agent
      .post(`/api/v1/workspaces/${workspaceId}/sources`)
      .attach('file', minimalPdf(), { filename: 'new.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toMatch(/PDF storage/);
    expect(await prismaClient.source.count({ where: { workspaceId } })).toBe(1);
  });
});

describe('daily token budget', () => {
  const now = new Date(Date.UTC(2026, 9, 24, 18, 0, 0));

  async function usage(tokensIn: number, tokensOut: number, createdAt: Date, type = 'LLM') {
    await prismaClient.usageEvent.create({
      data: {
        userId: alice.userId,
        type: type as 'LLM',
        task: 'agent',
        provider: 'google',
        model: 'gemini-3.6-flash',
        tokensIn,
        tokensOut,
        costUsd: 0,
        latencyMs: 1,
        ok: true,
        createdAt,
      },
    });
  }

  it('sums today’s model tokens only', async () => {
    await usage(1_000, 200, new Date(Date.UTC(2026, 9, 24, 1, 0, 0)));
    await usage(500, 0, new Date(Date.UTC(2026, 9, 23, 23, 59, 0)));
    await usage(9_999, 0, new Date(Date.UTC(2026, 9, 24, 2, 0, 0)), 'EMBEDDING');

    expect(await tokensUsedToday(alice.userId, now)).toBe(1_200);
  });

  it('refuses with the seconds until the next UTC day once the budget is used', async () => {
    const budget = appConfig.limits.dailyTokensPerUser;
    await usage(budget - 1, 0, new Date(Date.UTC(2026, 9, 24, 1, 0, 0)));
    await expect(assertTokenBudget(alice.userId, now)).resolves.toBeUndefined();

    await usage(1, 0, new Date(Date.UTC(2026, 9, 24, 1, 0, 0)));
    const error = await assertTokenBudget(alice.userId, now).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TooManyRequestsError);
    expect((error as TooManyRequestsError).details).toEqual({ retryAfterSeconds: 6 * 60 * 60 });
  });
});
