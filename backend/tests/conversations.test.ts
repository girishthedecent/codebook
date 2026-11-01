import { InngestTestEngine } from '@inngest/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import type { MessageRole, MessageStatus } from '../src/generated/prisma/client.js';
import { textRoutes } from '../src/llm/models.js';
import { afterTurn } from '../src/modules/chat/afterTurn.function.js';
import {
  cleanTitle,
  conversationHistory,
  provisionalTitle,
} from '../src/modules/chat/conversation.service.js';
import { countTokens } from '../src/utils/tokens.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { failingModel, promptModel, useModels } from './helpers/llm-mock.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));

type User = Awaited<ReturnType<typeof signedInUser>>;
type ConversationBody = { id: string; title: string; workspaceId: string };
type Page<T> = { items: T[]; nextCursor: string | null };
type MessageBody = {
  id: string;
  content: string;
  feedback: string | null;
  feedbackNote: string | null;
};

const MISSING_ID = 'cjld2cjxh0000qzrmn831i7rn';
const CHEAP_MODEL = textRoutes.cheap.primary.model;
const SUMMARY_MODEL = textRoutes.summarize.primary.model;

let alice: User;
let bob: User;
let workspaceId: string;

beforeEach(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  bob = await signedInUser('bob@example.com');
  const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Notes' });
  workspaceId = (res.body as { data: { id: string } }).data.id;
  useModels({});
});

const conversationsPath = (id = workspaceId) => `/api/v1/workspaces/${id}/conversations`;

async function startConversation(user = alice, body: { title?: string } = {}, id = workspaceId) {
  const res = await user.agent.post(conversationsPath(id)).send(body);
  expect(res.status).toBe(201);
  return (res.body as { data: ConversationBody }).data;
}

type NewMessage = { role: MessageRole; content: string; status?: MessageStatus };

// Messages a second apart, so their order doesn't depend on insert timing.
let clock = Date.parse('2026-01-01T00:00:00Z');
async function addMessages(conversationId: string, messages: NewMessage[]) {
  const rows = [];
  for (const message of messages) {
    clock += 1_000;
    rows.push(
      await prismaClient.message.create({
        data: { conversationId, ...message, createdAt: new Date(clock) },
      }),
    );
  }
  return rows;
}

/** `count` alternating messages, question first. */
const exchange = (count: number, content = (i: number) => `Message ${i}`) =>
  Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'USER' : 'ASSISTANT') as MessageRole,
    content: content(i),
  }));

/** Text of about `tokens` tokens. */
const textOf = (tokens: number, word = 'salt') => `${word} `.repeat(tokens).trim();

function runAfterTurn(conversationId: string) {
  const engine = new InngestTestEngine({
    function: afterTurn,
    events: [{ name: 'conversation/turn.completed', data: { conversationId, messageId: 'm' } }],
  });
  return engine.execute();
}

const loadConversation = (id: string) =>
  prismaClient.conversation.findUniqueOrThrow({ where: { id } });

describe('conversations API', () => {
  it('creates a conversation with the default title or a given one', async () => {
    const untitled = await startConversation();
    expect(untitled).toMatchObject({ title: 'New conversation', workspaceId });

    const titled = await startConversation(alice, { title: '  Hashing  ' });
    expect(titled.title).toBe('Hashing');

    for (const title of ['', '   ', 'x'.repeat(201)]) {
      expect((await alice.agent.post(conversationsPath()).send({ title })).status).toBe(400);
    }
  });

  it('lists the most recently active conversations first, a page at a time', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await startConversation()).id);
    // Renaming the oldest makes it the most recently active.
    await alice.agent.patch(`/api/v1/conversations/${ids[0]}`).send({ title: 'Back on top' });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: Record<string, string | number> = { limit: 2 };
      if (cursor) query.cursor = cursor;
      const res = await alice.agent.get(conversationsPath()).query(query);
      expect(res.status).toBe(200);
      const page = (res.body as { data: Page<ConversationBody> }).data;
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([ids[0], ids[4], ids[3], ids[2], ids[1]]);
  });

  it('returns a conversation with its messages oldest first, a page at a time', async () => {
    const { id } = await startConversation();
    const rows = await addMessages(id, exchange(5));

    const first = await alice.agent.get(`/api/v1/conversations/${id}`).query({ limit: 3 });
    expect(first.status).toBe(200);
    const body = (first.body as { data: ConversationBody & { messages: Page<MessageBody> } }).data;
    expect(body.title).toBe('New conversation');
    expect(body.messages.items.map((m) => m.content)).toEqual([
      'Message 0',
      'Message 1',
      'Message 2',
    ]);
    // Internal columns stay out of the response.
    expect(body).not.toHaveProperty('summary');

    const second = await alice.agent
      .get(`/api/v1/conversations/${id}`)
      .query({ limit: 3, cursor: body.messages.nextCursor });
    const rest = (second.body as { data: { messages: Page<MessageBody> } }).data.messages;
    expect(rest.items.map((m) => m.id)).toEqual([rows[3]!.id, rows[4]!.id]);
    expect(rest.nextCursor).toBeNull();
  });

  it('renames and deletes a conversation with its messages', async () => {
    const { id } = await startConversation();
    await addMessages(id, exchange(2));

    const renamed = await alice.agent.patch(`/api/v1/conversations/${id}`).send({ title: 'Salts' });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { data: ConversationBody }).data.title).toBe('Salts');
    expect((await alice.agent.patch(`/api/v1/conversations/${id}`).send({})).status).toBe(400);

    expect((await alice.agent.delete(`/api/v1/conversations/${id}`)).status).toBe(204);
    expect((await alice.agent.get(`/api/v1/conversations/${id}`)).status).toBe(404);
    expect(await prismaClient.message.count({ where: { conversationId: id } })).toBe(0);
    expect((await alice.agent.delete(`/api/v1/conversations/${id}`)).status).toBe(404);
  });

  describe('pins', () => {
    const patch = (id: string, body: object, user = alice) =>
      user.agent.patch(`/api/v1/conversations/${id}`).send(body);

    async function listIds(limit = 100) {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const query: Record<string, string | number> = { limit };
        if (cursor) query.cursor = cursor;
        const res = await alice.agent.get(conversationsPath()).query(query);
        expect(res.status).toBe(200);
        const page = (res.body as { data: Page<ConversationBody> }).data;
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);
      return ids;
    }

    it('pins and unpins without counting as activity', async () => {
      const { id } = await startConversation();
      const before = await loadConversation(id);

      const pinned = await patch(id, { pinned: true });
      expect(pinned.status).toBe(200);
      const body = (pinned.body as { data: ConversationBody & { pinnedAt: string | null } }).data;
      expect(body.pinnedAt).toEqual(expect.any(String));
      expect(body.title).toBe('New conversation');
      expect((await loadConversation(id)).updatedAt).toEqual(before.updatedAt);

      // Pinning again keeps the pin time.
      const again = await patch(id, { pinned: true });
      expect((again.body as { data: { pinnedAt: string } }).data.pinnedAt).toBe(body.pinnedAt);

      const unpinned = await patch(id, { pinned: false });
      expect((unpinned.body as { data: { pinnedAt: string | null } }).data.pinnedAt).toBeNull();
      expect((await loadConversation(id)).updatedAt).toEqual(before.updatedAt);
    });

    it('renames and pins in one request', async () => {
      const { id } = await startConversation();
      const res = await patch(id, { title: 'Salts', pinned: true });
      expect(res.status).toBe(200);
      expect((res.body as { data: object }).data).toMatchObject({
        title: 'Salts',
        pinnedAt: expect.any(String),
      });
      expect((await patch(id, { pinned: 'yes' })).status).toBe(400);
      expect((await patch(id, { pinned: true }, bob)).status).toBe(404);
      expect((await loadConversation(id)).pinnedAt).not.toBeNull();
    });

    it('lists pinned conversations first, the latest pinned on top, across pages', async () => {
      const ids = [];
      for (let i = 0; i < 6; i++) ids.push((await startConversation()).id);
      // Pin times a second apart, so the order doesn't depend on timing.
      await prismaClient.conversation.update({
        where: { id: ids[1] },
        data: { pinnedAt: new Date('2026-01-01T00:00:01Z') },
      });
      await prismaClient.conversation.update({
        where: { id: ids[3] },
        data: { pinnedAt: new Date('2026-01-01T00:00:02Z') },
      });

      const expected = [ids[3], ids[1], ids[5], ids[4], ids[2], ids[0]];
      expect(await listIds()).toEqual(expected);
      for (const limit of [1, 2, 4]) expect(await listIds(limit)).toEqual(expected);
    });

    it('refuses a cursor it did not make', async () => {
      const cursor = Buffer.from(JSON.stringify(['2026-01-01T00:00:00Z', 'x'])).toString(
        'base64url',
      );
      expect((await alice.agent.get(conversationsPath()).query({ cursor })).status).toBe(400);
    });
  });

  it('previews the first question, on one line and cut to 120 characters', async () => {
    const { id: empty } = await startConversation();
    const { id: short } = await startConversation();
    const { id: long } = await startConversation();
    await addMessages(short, [
      { role: 'USER', content: '  Why salt\n\na hash?  ' },
      { role: 'ASSISTANT', content: 'So equal passwords hash apart.' },
      { role: 'USER', content: 'And pepper?' },
    ]);
    await addMessages(long, [{ role: 'USER', content: 'word '.repeat(60) }]);

    const res = await alice.agent.get(conversationsPath());
    const items = (res.body as { data: Page<ConversationBody & { preview: string | null }> }).data
      .items;
    const preview = (id: string) => items.find((item) => item.id === id)!.preview;
    expect(preview(empty)).toBeNull();
    expect(preview(short)).toBe('Why salt a hash?');
    expect(Array.from(preview(long)!)).toHaveLength(120);
    expect(preview(long)!.endsWith('word…')).toBe(true);

    const detail = await alice.agent.get(`/api/v1/conversations/${short}`);
    expect((detail.body as { data: { preview: string } }).data.preview).toBe('Why salt a hash?');
    const renamed = await alice.agent.patch(`/api/v1/conversations/${short}`).send({ title: 'S' });
    expect((renamed.body as { data: { preview: string } }).data.preview).toBe('Why salt a hash?');
  });

  it("hides other users' conversations and workspaces behind a 404", async () => {
    const { id } = await startConversation();
    const [, answer] = await addMessages(id, exchange(2));

    expect((await bob.agent.get(`/api/v1/conversations/${id}`)).status).toBe(404);
    expect((await bob.agent.patch(`/api/v1/conversations/${id}`).send({ title: 'x' })).status).toBe(
      404,
    );
    expect((await bob.agent.delete(`/api/v1/conversations/${id}`)).status).toBe(404);
    expect(
      (await bob.agent.post(`/api/v1/messages/${answer!.id}/feedback`).send({ value: 'UP' }))
        .status,
    ).toBe(404);
    expect((await bob.agent.get(conversationsPath())).status).toBe(404);
    expect((await bob.agent.post(conversationsPath()).send({})).status).toBe(404);
    expect((await loadConversation(id)).title).toBe('New conversation');
  });

  it('lets anyone chat on the demo workspace, each user seeing only their own threads', async () => {
    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });
    const own = await startConversation(alice);
    const guest = await startConversation(bob);

    const list = async (user: User) =>
      ((await user.agent.get(conversationsPath())).body as { data: Page<ConversationBody> }).data
        .items;
    expect((await list(alice)).map((c) => c.id)).toEqual([own.id]);
    expect((await list(bob)).map((c) => c.id)).toEqual([guest.id]);
    expect((await alice.agent.get(`/api/v1/conversations/${guest.id}`)).status).toBe(404);
    expect((await bob.agent.get(`/api/v1/conversations/${own.id}`)).status).toBe(404);

    // The demo stops being public: guests lose access to what they started there.
    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: false } });
    expect((await bob.agent.get(`/api/v1/conversations/${guest.id}`)).status).toBe(404);
  });

  it("adds the user's conversation count to the workspace", async () => {
    await startConversation();
    await startConversation();
    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });
    await startConversation(bob);

    const res = await alice.agent.get(`/api/v1/workspaces/${workspaceId}`);
    expect((res.body as { data: { counts: { conversations: number } } }).data.counts).toMatchObject(
      { conversations: 2 },
    );
  });

  describe('what an answer cost', () => {
    const FIELDS = [
      'model',
      'latencyMs',
      'firstTokenMs',
      'tokensIn',
      'tokensOut',
      'tokensCached',
      'costUsd',
      'weakRetrieval',
    ];

    async function conversationWithAnswer(owner: User, reader: User) {
      const { id } = await startConversation(reader);
      const [question, answer] = await addMessages(id, exchange(2));
      await prismaClient.message.update({
        where: { id: answer!.id },
        data: {
          model: 'google/gemini-3.6-flash',
          latencyMs: 5_400,
          firstTokenMs: 900,
          tokensIn: 3_200,
          tokensOut: 410,
          tokensCached: 1_000,
          costUsd: '0.0123',
          weakRetrieval: true,
        },
      });
      return { id, question: question!, answer: answer!, owner };
    }

    const messagesOf = async (user: User, id: string) =>
      (
        (await user.agent.get(`/api/v1/conversations/${id}`)).body as {
          data: { messages: Page<Record<string, unknown>> };
        }
      ).data.messages.items;

    it('gives the owner of the workspace what the turn used, on answers only', async () => {
      const { id } = await conversationWithAnswer(alice, alice);

      const [question, answer] = await messagesOf(alice, id);

      expect(answer).toMatchObject({
        model: 'google/gemini-3.6-flash',
        latencyMs: 5_400,
        firstTokenMs: 900,
        tokensIn: 3_200,
        tokensOut: 410,
        tokensCached: 1_000,
        costUsd: '0.0123',
        weakRetrieval: true,
      });
      for (const field of FIELDS) expect(question, field).not.toHaveProperty(field);
    });

    it('keeps it from visitors of the demo, who read answers in the owner’s workspace', async () => {
      await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });
      const { id, answer } = await conversationWithAnswer(alice, bob);

      const [, shown] = await messagesOf(bob, id);

      expect(shown).toMatchObject({ id: answer.id, content: answer.content, status: 'COMPLETE' });
      for (const field of FIELDS) expect(shown, field).not.toHaveProperty(field);
    });

    it('applies to the answer a rating returns too', async () => {
      const { answer } = await conversationWithAnswer(alice, alice);
      const rated = await alice.agent
        .post(`/api/v1/messages/${answer.id}/feedback`)
        .send({ value: 'UP' });
      expect((rated.body as { data: object }).data).toMatchObject({ costUsd: '0.0123' });

      await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });
      const visitor = await conversationWithAnswer(alice, bob);
      const visited = await bob.agent
        .post(`/api/v1/messages/${visitor.answer.id}/feedback`)
        .send({ value: 'DOWN' });
      expect(visited.status).toBe(200);
      expect((visited.body as { data: object }).data).not.toHaveProperty('costUsd');
    });
  });

  it('returns 404 for a missing conversation and 400 for a bad id', async () => {
    expect((await alice.agent.get(`/api/v1/conversations/${MISSING_ID}`)).status).toBe(404);
    expect((await alice.agent.get('/api/v1/conversations/not-an-id')).status).toBe(400);
    expect((await alice.agent.post('/api/v1/messages/not-an-id/feedback')).status).toBe(400);
  });
});

describe('feedback', () => {
  const feedback = (user: User, messageId: string, body: object) =>
    user.agent.post(`/api/v1/messages/${messageId}/feedback`).send(body);

  it('rates an answer, replacing the earlier rating', async () => {
    const { id } = await startConversation();
    const [, answer] = await addMessages(id, exchange(2));

    const up = await feedback(alice, answer!.id, { value: 'UP', note: 'Spot on' });
    expect(up.status).toBe(200);
    expect((up.body as { data: MessageBody }).data).toMatchObject({
      feedback: 'UP',
      feedbackNote: 'Spot on',
    });

    await feedback(alice, answer!.id, { value: 'DOWN' });
    const stored = await prismaClient.message.findUniqueOrThrow({ where: { id: answer!.id } });
    expect(stored).toMatchObject({ feedback: 'DOWN', feedbackNote: null });
  });

  it('refuses questions, unknown values and missing messages', async () => {
    const { id } = await startConversation();
    const [question, answer] = await addMessages(id, exchange(2));

    expect((await feedback(alice, question!.id, { value: 'UP' })).status).toBe(400);
    expect((await feedback(alice, answer!.id, { value: 'MEH' })).status).toBe(400);
    expect((await feedback(alice, answer!.id, { value: 'UP', note: '' })).status).toBe(400);
    expect((await feedback(alice, MISSING_ID, { value: 'UP' })).status).toBe(404);
  });
});

describe('after-turn function', () => {
  it('names a new conversation from its first question and answer', async () => {
    const { id } = await startConversation();
    await addMessages(id, [
      { role: 'USER', content: 'Why do password hashes need a salt?' },
      { role: 'ASSISTANT', content: 'A salt makes equal passwords hash differently [1].' },
      { role: 'USER', content: 'And pepper?' },
    ]);
    const prompts: string[] = [];
    useModels({
      [CHEAP_MODEL]: promptModel((prompt) => {
        prompts.push(prompt);
        return '"Salting password hashes for safety and fun."';
      }),
    });

    const { result } = await runAfterTurn(id);

    expect(result).toMatchObject({ named: true, summarized: false });
    expect((await loadConversation(id)).title).toBe('Salting password hashes for safety and');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Why do password hashes need a salt?');
    expect(prompts[0]).toContain('A salt makes equal passwords hash differently');
    expect(prompts[0]).not.toContain('And pepper?');
  });

  it('keeps a title the user set, and waits for a finished answer', async () => {
    useModels({ [CHEAP_MODEL]: failingModel(new Error('should not be called')) });

    const renamed = await startConversation(alice, { title: 'My title' });
    await addMessages(renamed.id, exchange(2));
    await runAfterTurn(renamed.id);
    expect((await loadConversation(renamed.id)).title).toBe('My title');

    const failed = await startConversation();
    await addMessages(failed.id, [
      { role: 'USER', content: 'Hello?' },
      { role: 'ASSISTANT', content: 'Partial', status: 'ERROR' },
    ]);
    const { result } = await runAfterTurn(failed.id);
    expect(result).toMatchObject({ named: false });
    expect((await loadConversation(failed.id)).title).toBe('New conversation');
  });

  it('replaces the name the question gave the conversation, but not one typed over it', async () => {
    const question = 'Why do password hashes need a salt?';
    const messages = [
      { role: 'USER' as const, content: question },
      { role: 'ASSISTANT' as const, content: 'A salt makes equal passwords hash differently.' },
    ];
    useModels({ [CHEAP_MODEL]: promptModel(() => 'Salting password hashes') });

    const named = await startConversation(alice, { title: provisionalTitle(question)! });
    await addMessages(named.id, messages);
    expect(provisionalTitle(question)).toBe(question);
    expect(await runAfterTurn(named.id)).toMatchObject({ result: { named: true } });
    expect((await loadConversation(named.id)).title).toBe('Salting password hashes');

    const typed = await startConversation(alice, { title: 'Salt notes' });
    await addMessages(typed.id, messages);
    expect(await runAfterTurn(typed.id)).toMatchObject({ result: { named: false } });
    expect((await loadConversation(typed.id)).title).toBe('Salt notes');
  });

  it('knows the name of a long question as it was cut', async () => {
    const question = `${'Why do password hashes need a salt, '.repeat(3)}really?`;
    const provisional = provisionalTitle(question)!;
    expect(provisional.endsWith('…')).toBe(true);
    useModels({ [CHEAP_MODEL]: promptModel(() => 'Salting password hashes') });
    const { id } = await startConversation(alice, { title: provisional });
    await addMessages(id, [
      { role: 'USER', content: question },
      { role: 'ASSISTANT', content: 'A salt makes equal passwords hash differently.' },
    ]);

    await runAfterTurn(id);

    expect((await loadConversation(id)).title).toBe('Salting password hashes');
  });

  it('lets a rename made while the title was being written win', async () => {
    const { id } = await startConversation(alice, { title: 'Hello?' });
    await addMessages(id, [
      { role: 'USER', content: 'Hello?' },
      { role: 'ASSISTANT', content: 'Hi there.' },
    ]);
    const model = promptModel(() => 'Generated title');
    const generate = model.doGenerate.bind(model);
    model.doGenerate = async (options) => {
      const reply = await generate(options);
      await prismaClient.conversation.update({ where: { id }, data: { title: 'Typed meanwhile' } });
      return reply;
    };
    useModels({ [CHEAP_MODEL]: model });

    const { result } = await runAfterTurn(id);

    expect(result).toMatchObject({ named: false });
    expect((await loadConversation(id)).title).toBe('Typed meanwhile');
  });

  it('cleans the model reply into a short title', () => {
    expect(cleanTitle('  **Hash tables**  \nextra line')).toBe('Hash tables');
    expect(cleanTitle("'Big-O of sorting!'")).toBe('Big-O of sorting');
    expect(cleanTitle('one two three four five six seven eight')).toBe(
      'one two three four five six',
    );
    expect(cleanTitle('""')).toBe('');
  });

  it('folds older messages into the summary once they pass the threshold', async () => {
    const { historyMessages, summarizeAfterTokens } = appConfig.chat;
    const { id } = await startConversation(alice, { title: 'Set' });
    const summaryPrompts: string[] = [];
    useModels({
      [SUMMARY_MODEL]: promptModel((prompt) => {
        summaryPrompts.push(prompt);
        return `Summary ${summaryPrompts.length}`;
      }),
    });

    // Older messages just under the threshold, plus the kept window: no summary yet.
    const older = 4;
    const perMessage = Math.floor(summarizeAfterTokens / older) - 5;
    const first = await addMessages(
      id,
      exchange(older + historyMessages, (i) =>
        i < older ? textOf(perMessage) : `Kept ${i} ${textOf(30, 'pad')}`,
      ),
    );
    expect(first.slice(0, older).reduce((sum, m) => sum + countTokens(m.content), 0)).toBeLessThan(
      summarizeAfterTokens,
    );
    expect((await runAfterTurn(id)).result).toMatchObject({ summarized: false });
    expect(summaryPrompts).toHaveLength(0);

    // One more exchange pushes two more messages out of the kept window, past the threshold.
    await addMessages(
      id,
      exchange(2, (i) => `Newest ${i}`),
    );
    expect((await runAfterTurn(id)).result).toMatchObject({ summarized: true });

    let conversation = await loadConversation(id);
    expect(conversation.summary).toBe('Summary 1');
    expect(conversation.summarizedUpToMessageId).toBe(first[older + 1]!.id);
    expect(summaryPrompts[0]).toContain('<summary>\n\n</summary>');
    expect(summaryPrompts[0]).toContain('Kept 5');
    expect(summaryPrompts[0]).not.toContain('Kept 6');

    // The next fold starts from the stored summary and only reads what came after it.
    await addMessages(
      id,
      exchange(historyMessages + 2, (i) =>
        i < 4 ? textOf(summarizeAfterTokens, 'pepper') : `Late ${i}`,
      ),
    );
    expect((await runAfterTurn(id)).result).toMatchObject({ summarized: true });
    conversation = await loadConversation(id);
    expect(conversation.summary).toBe('Summary 2');
    expect(summaryPrompts[1]).toContain('<summary>\nSummary 1\n</summary>');
    expect(summaryPrompts[1]).not.toContain('Kept 5');
    expect(summaryPrompts[1]).toContain('Newest 0');
  });
});

describe('conversationHistory', () => {
  it('returns the summary and the latest messages after it, capped by count', async () => {
    const { historyMessages } = appConfig.chat;
    const { id } = await startConversation();
    const rows = await addMessages(id, exchange(historyMessages + 6));
    await prismaClient.conversation.update({
      where: { id },
      data: { summary: 'Earlier talk', summarizedUpToMessageId: rows[1]!.id },
    });
    // A failed answer isn't something the model should read back.
    const [failed] = await addMessages(id, [
      { role: 'ASSISTANT', content: 'Half an answer', status: 'ERROR' },
    ]);

    const history = await conversationHistory(id);

    expect(history.summary).toBe('Earlier talk');
    expect(history.recent.map((m) => m.id)).toEqual(rows.slice(-historyMessages).map((m) => m.id));
    expect(history.recent.map((m) => m.id)).not.toContain(failed!.id);
  });

  it('drops the oldest messages to stay within the token cap', async () => {
    const { historyTokens } = appConfig.chat;
    const { id } = await startConversation();
    // Two fit under the cap, three don't.
    const big = Math.floor(historyTokens * 0.4);
    const rows = await addMessages(
      id,
      exchange(4, () => textOf(big)),
    );

    const { summary, recent } = await conversationHistory(id);

    expect(summary).toBeNull();
    expect(recent.map((m) => m.id)).toEqual(rows.slice(-2).map((m) => m.id));
    expect(recent.reduce((sum, m) => sum + countTokens(m.content), 0)).toBeLessThanOrEqual(
      historyTokens,
    );
  });

  it('is empty for a conversation that is gone', async () => {
    expect(await conversationHistory(MISSING_ID)).toEqual({ summary: null, recent: [] });
  });
});
