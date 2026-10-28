import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { inngest } from '../src/config/inngest.config.js';
import { resetCircuitBreaker } from '../src/llm/circuitBreaker.js';
import { textRoutes } from '../src/llm/models.js';
import { DEFAULT_TITLE } from '../src/modules/chat/conversation.service.js';
import {
  answerCacheKey,
  copiesPassage,
  findCachedAnswer,
  normalizeQuestion,
} from '../src/modules/demo/answerCache.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { streamingModel, useModels, type StreamTurn } from './helpers/llm-mock.js';
import { seedSource, vectorOf } from './helpers/retrieval.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
// The real cache, wrapped so a test can make a lookup fail.
vi.mock('../src/modules/demo/answerCache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/demo/answerCache.js')>();
  return {
    ...actual,
    answerCacheKey: vi.fn(actual.answerCacheKey),
    findCachedAnswer: vi.fn(actual.findCachedAnswer),
  };
});

type User = Awaited<ReturnType<typeof signedInUser>>;
type SseEvent = { event: string; data: Record<string, unknown> };

const PRIMARY = textRoutes.agent.primary.model;
const FALLBACK = textRoutes.agent.fallback!.model;
const PASSAGE = 'A salt is random data mixed into each password before hashing it.';
const ANSWER = 'A salt is random data added to each password [1].';
const search = { name: 'search_sources', input: { query: 'what is a salt' } };
const LONG_PASSAGE =
  'A salt is random data mixed into each password before it is hashed, so two users with ' +
  'the same password end up with different hashes. Because every hash has its own salt, an ' +
  'attacker cannot build one table of precomputed hashes for every account at once, and has ' +
  'to attack each password on its own, which makes a stolen password table far less useful.';

let demoId: string;
let sourceId: string;
let send: ReturnType<typeof vi.spyOn>;

async function guest(email: string) {
  const user = await signedInUser(email);
  await prismaClient.user.update({ where: { id: user.userId }, data: { isGuest: true } });
  return user;
}

beforeEach(async () => {
  await resetDb();
  resetCircuitBreaker();
  send = vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] } as never);
  const owner = await prismaClient.user.create({
    data: { id: 'demo-owner', name: 'Demo', email: 'demo@example.com', isSystem: true },
  });
  const demo = await prismaClient.workspace.create({
    data: { userId: owner.id, name: 'Demo', isDemo: true },
  });
  demoId = demo.id;
  await seedSource(demoId, {
    title: 'Security Book',
    chunks: { salt: { content: PASSAGE, vector: vectorOf(1) } },
  });
  sourceId = (await prismaClient.source.findFirstOrThrow({ where: { workspaceId: demoId } })).id;
});

const searchThenAnswer = (text = ANSWER): StreamTurn[] => [{ toolCalls: [search] }, { text }];

/** Scripts the models for one question; returns them to count the calls it made. */
function play(primary: StreamTurn[] = searchThenAnswer()) {
  const models = {
    [PRIMARY]: streamingModel(primary),
    [FALLBACK]: streamingModel([new Error('unused')]),
  };
  useModels(models);
  return models;
}

function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [, event] = /^event: (.+)$/m.exec(block)!;
      const [, data] = /^data: (.+)$/m.exec(block)!;
      return { event: event!, data: JSON.parse(data!) as Record<string, unknown> };
    });
}

async function newConversation(user: User, workspaceId = demoId, title = 'Demo question') {
  const conversation = await prismaClient.conversation.create({
    data: { workspaceId, userId: user.userId, title },
  });
  return conversation.id;
}

async function ask(user: User, conversationId: string, content: string, useMemory?: boolean) {
  const res = await user.agent
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .send(useMemory === undefined ? { content } : { content, useMemory })
    .buffer(true);
  return { res, events: res.status === 200 ? parseSse(res.text) : [] };
}

const turnCompleted = () =>
  send.mock.calls.filter((call: unknown[]) =>
    (call[0] as { name: string }).name.endsWith('turn.completed'),
  );

describe('demo answer cache', () => {
  it('answers a repeat first question from the cache, without the model', async () => {
    play();
    const first = await guest('first@example.com');
    const firstAsk = await ask(first, await newConversation(first), 'What is a salt?');
    expect(firstAsk.events.at(-1)!.event).toBe('done');
    expect(await prismaClient.answerCache.count()).toBe(1);
    expect(turnCompleted()).toHaveLength(1);

    const models = play();
    const second = await guest('second@example.com');
    const conversationId = await newConversation(second);
    const { events } = await ask(second, conversationId, '  what IS a   salt ');

    expect(models[PRIMARY]!.doStreamCalls).toHaveLength(0);
    expect(events.map((e) => e.event)).toEqual(['token', 'citations', 'done']);
    expect(events[0]!.data.text).toBe(ANSWER);
    const live = firstAsk.events.find((e) => e.event === 'citations')!.data.items;
    expect(events[1]!.data.items).toEqual(live);

    const saved = await prismaClient.message.findFirstOrThrow({
      where: { conversationId, role: 'ASSISTANT' },
    });
    expect(saved).toMatchObject({
      content: ANSWER,
      status: 'COMPLETE',
      model: `google/${PRIMARY}`,
      promptVersion: 'agent-system@v4',
      tokensIn: 0,
      tokensOut: 0,
      memoryOff: true,
    });
    expect(saved.citations).toEqual(live);
    expect(events[2]!.data).toMatchObject({ messageId: saved.id, usage: { tokensIn: 0 } });
    // No title or summary work for an answer that was already there.
    expect(turnCompleted()).toHaveLength(1);
  });

  it('asks the model again for a follow-up, even when its text was cached', async () => {
    play();
    const visitor = await guest('visitor@example.com');
    const conversationId = await newConversation(visitor);
    await ask(visitor, conversationId, 'What is a salt?');

    const models = play();
    await ask(visitor, conversationId, 'What is a salt?');

    expect(models[PRIMARY]!.doStreamCalls.length).toBeGreaterThan(0);
    expect(await prismaClient.answerCache.count()).toBe(1);
  });

  it('keeps no answer with a citation that points nowhere', async () => {
    play(searchThenAnswer('Salts are random [1]. And blue [7].'));
    const visitor = await guest('visitor@example.com');
    await ask(visitor, await newConversation(visitor), 'What is a salt?');
    expect(await prismaClient.answerCache.count()).toBe(0);
  });

  it('keeps no answer without citations', async () => {
    play([{ text: 'A salt is random data.' }]);
    const visitor = await guest('visitor@example.com');
    await ask(visitor, await newConversation(visitor), 'What is a salt?');
    expect(await prismaClient.answerCache.count()).toBe(0);
  });

  it('leaves workspaces other than the demo and memory-on turns alone', async () => {
    play();
    const reader = await signedInUser('reader@example.com');
    const own = await prismaClient.workspace.create({
      data: { userId: reader.userId, name: 'Mine' },
    });
    await seedSource(own.id, {
      title: 'Security Book',
      chunks: { salt: { content: PASSAGE, vector: vectorOf(1) } },
    });
    await ask(reader, await newConversation(reader, own.id), 'What is a salt?', false);
    // A signed-up visitor to the demo with memory on gets an answer of their own.
    play();
    await ask(reader, await newConversation(reader), 'What is a salt?', true);
    expect(await prismaClient.answerCache.count()).toBe(0);

    play();
    await ask(reader, await newConversation(reader), 'What is a salt?', false);
    expect(await prismaClient.answerCache.count()).toBe(1);
  });

  it('misses once the answer is older than the TTL or a source was ingested again', async () => {
    play();
    const visitor = await guest('visitor@example.com');
    await ask(visitor, await newConversation(visitor), 'What is a salt?');
    const expired = new Date(Date.now() - (appConfig.demo.answerCacheTtlSec + 60) * 1000);
    await prismaClient.answerCache.updateMany({ data: { createdAt: expired } });

    let models = play();
    await ask(visitor, await newConversation(visitor), 'What is a salt?');
    expect(models[PRIMARY]!.doStreamCalls.length).toBeGreaterThan(0);
    // The expired row was replaced by the fresh answer.
    const [row] = await prismaClient.answerCache.findMany();
    expect(row!.createdAt.getTime()).toBeGreaterThan(expired.getTime());

    await prismaClient.source.update({
      where: { id: sourceId },
      data: { lastIngestedAt: new Date() },
    });
    models = play();
    await ask(visitor, await newConversation(visitor), 'What is a salt?');
    expect(models[PRIMARY]!.doStreamCalls.length).toBeGreaterThan(0);
    expect(await prismaClient.answerCache.count()).toBe(2);
  });

  it('names a default-titled conversation after the question on a hit', async () => {
    play();
    const first = await guest('first@example.com');
    await ask(first, await newConversation(first), 'What is a salt?');

    play();
    const second = await guest('second@example.com');
    const untitled = await newConversation(second, demoId, DEFAULT_TITLE);
    await ask(second, untitled, 'What is a salt?');
    play();
    const renamed = await newConversation(second, demoId, 'My salt notes');
    await ask(second, renamed, 'What is a salt?');

    const titles = await prismaClient.conversation.findMany({
      where: { id: { in: [untitled, renamed] } },
      select: { id: true, title: true },
    });
    expect(Object.fromEntries(titles.map((c) => [c.id, c.title]))).toEqual({
      [untitled]: 'What is a salt?',
      [renamed]: 'My salt notes',
    });
  });

  it('keeps no answer that copies a passage at length', async () => {
    const page = `${LONG_PASSAGE} ${LONG_PASSAGE}`;
    await prismaClient.sourceChunk.updateMany({
      where: { workspaceId: demoId },
      data: { content: page },
    });
    play(searchThenAnswer(`As the book puts it: ${page.slice(0, 300)} [1]`));
    const visitor = await guest('visitor@example.com');
    const { events } = await ask(visitor, await newConversation(visitor), 'What is a salt?');

    expect(events.at(-1)!.event).toBe('done');
    const citations = events.find((e) => e.event === 'citations')!.data.items as {
      valid: boolean;
    }[];
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.every((c) => c.valid)).toBe(true);
    expect(await prismaClient.answerCache.count()).toBe(0);
  });

  it.each([
    ['the lookup', () => vi.mocked(findCachedAnswer)],
    ['the key', () => vi.mocked(answerCacheKey)],
  ])('answers live when %s fails', async (_, failing) => {
    failing().mockRejectedValueOnce(new Error('database went away'));
    const models = play();
    const visitor = await guest('visitor@example.com');
    const conversationId = await newConversation(visitor);
    const { res, events } = await ask(visitor, conversationId, 'What is a salt?');

    expect(res.status).toBe(200);
    expect(events.at(-1)!.event).toBe('done');
    expect(models[PRIMARY]!.doStreamCalls.length).toBeGreaterThan(0);
    const saved = await prismaClient.message.findFirstOrThrow({
      where: { conversationId, role: 'ASSISTANT' },
    });
    expect(saved).toMatchObject({ content: ANSWER, status: 'COMPLETE' });
  });

  it('normalizes case, spacing and closing punctuation only', () => {
    expect(normalizeQuestion('  What IS\n a salt?! ')).toBe('what is a salt');
    expect(normalizeQuestion('What is a salt in C#?')).toBe('what is a salt in c');
    expect(normalizeQuestion('Is v1.2 safe')).toBe('is v1.2 safe');
  });
});

describe('copiesPassage', () => {
  const run = LONG_PASSAGE.slice(0, 260);

  it('finds a long verbatim run inside a longer answer', () => {
    expect(copiesPassage(`In short: ${run} That is all [1].`, ['other text', LONG_PASSAGE])).toBe(
      true,
    );
  });

  it('reads line breaks and doubled spaces as one space', () => {
    const reflowed = run.replace(/ /g, (space, i: number) => (i % 3 === 0 ? '\n' : '  '));
    expect(copiesPassage(`In short: ${reflowed} That is all.`, [LONG_PASSAGE])).toBe(true);
  });

  it('allows a short quote in a long answer', () => {
    const answer = `The book says "${LONG_PASSAGE.slice(0, 120)}", ${'and explains why. '.repeat(10)}`;
    expect(answer.length).toBeGreaterThan(250);
    expect(copiesPassage(answer, [LONG_PASSAGE])).toBe(false);
  });

  it('never flags an answer shorter than the window', () => {
    expect(copiesPassage(LONG_PASSAGE.slice(0, 150), [LONG_PASSAGE])).toBe(false);
  });
});

describe('guest message limit', () => {
  it('counts the demo questions of every guest from one IP together', async () => {
    play();
    const first = await guest('first@example.com');
    expect((await ask(first, await newConversation(first), 'What is a salt?')).res.status).toBe(
      200,
    );
    const [hit] = await prismaClient.rateLimitHit.findMany({
      where: { key: { startsWith: 'guestMessages:ip:' } },
    });
    expect(hit).toBeDefined();
    const { points } = appConfig.limits.windows.guestMessages;
    await prismaClient.rateLimitHit.update({
      where: { key_windowStart: { key: hit!.key, windowStart: hit!.windowStart } },
      data: { count: points },
    });

    const second = await guest('second@example.com');
    const blocked = await ask(second, await newConversation(second), 'What is a salt?');
    expect(blocked.res.status).toBe(429);
    expect(blocked.res.headers['retry-after']).toBeDefined();

    // Signed-up users on the same IP aren't counted by the guest limit.
    play();
    const reader = await signedInUser('reader@example.com');
    expect((await ask(reader, await newConversation(reader), 'What is a salt?')).res.status).toBe(
      200,
    );
  });
});
