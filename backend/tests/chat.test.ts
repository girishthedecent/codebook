import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { inngest } from '../src/config/inngest.config.js';
import { resetCircuitBreaker } from '../src/llm/circuitBreaker.js';
import { textRoutes } from '../src/llm/models.js';
import { agentSystemPrompt } from '../src/llm/prompts/agentSystem.js';
import { DEFAULT_TITLE } from '../src/modules/chat/conversation.service.js';
import { countTokens } from '../src/utils/tokens.js';
import {
  prepareTurnService,
  runTurnService,
  type TurnEvent,
} from '../src/modules/chat/turn.service.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import {
  apiError,
  stallingStreamModel,
  streamingModel,
  useModels,
  type StreamTurn,
} from './helpers/llm-mock.js';
import { seedSource, vectorOf } from './helpers/retrieval.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));

type User = Awaited<ReturnType<typeof signedInUser>>;
type SseEvent = { event: string; data: Record<string, unknown> };

const PRIMARY = textRoutes.agent.primary.model;
const FALLBACK = textRoutes.agent.fallback!.model;
const MISSING_ID = 'cjld2cjxh0000qzrmn831i7rn';
const PASSAGE = 'A salt is random data mixed into each password before hashing it.';

let alice: User;
let workspaceId: string;
let conversationId: string;
let send: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await resetDb();
  resetCircuitBreaker();
  send = vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] } as never);
  alice = await signedInUser('alice@example.com');
  const workspace = await alice.agent.post('/api/v1/workspaces').send({ name: 'Security' });
  workspaceId = (workspace.body as { data: { id: string } }).data.id;
  await seedSource(workspaceId, {
    title: 'Security Book',
    chunks: { salt: { content: PASSAGE, vector: vectorOf(1) } },
  });
  const conversation = await alice.agent
    .post(`/api/v1/workspaces/${workspaceId}/conversations`)
    .send({});
  conversationId = (conversation.body as { data: { id: string } }).data.id;
});

const search = { name: 'search_sources', input: { query: 'what is a salt' } };

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

async function ask(content: string, user = alice, id = conversationId, extra = {}) {
  const res = await user.agent
    .post(`/api/v1/conversations/${id}/messages`)
    .send({ content, ...extra })
    .buffer(true);
  return { res, events: res.status === 200 ? parseSse(res.text) : [] };
}

const answers = () =>
  prismaClient.message.findMany({
    where: { conversationId, role: 'ASSISTANT' },
    orderBy: { createdAt: 'asc' },
  });

const play = (primary: StreamTurn[], fallback: StreamTurn[] = [new Error('unused')]) => {
  const models = { [PRIMARY]: streamingModel(primary), [FALLBACK]: streamingModel(fallback) };
  useModels(models);
  return models;
};

describe('chat turns', () => {
  it('searches, streams a cited answer and saves it', async () => {
    play([{ toolCalls: [search] }, { text: 'A salt is random data added to each password [1].' }]);

    const { res, events } = await ask('What is a salt?');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const kinds = events.map((e) => e.event);
    expect(kinds.slice(0, 3)).toEqual(['title', 'step', 'step']);
    expect(kinds).toContain('token');
    expect(kinds.slice(-2)).toEqual(['citations', 'done']);
    expect(events[0]!.data).toEqual({ title: 'What is a salt?' });
    const [start, end] = [events[1]!.data, events[2]!.data];
    expect(start).toMatchObject({ index: 1, tool: 'search_sources', status: 'start' });
    expect(end).toMatchObject({ index: 1, tool: 'search_sources', status: 'end', ok: true });
    expect(start).not.toHaveProperty('ok');
    expect(end.id).toBe(start.id);

    const text = events
      .filter((e) => e.event === 'token')
      .map((e) => e.data.text)
      .join('');
    expect(text).toBe('A salt is random data added to each password [1].');
    const citations = events.find((e) => e.event === 'citations')!.data.items as Record<
      string,
      unknown
    >[];
    expect(citations).toEqual([
      expect.objectContaining({ n: 1, valid: true, supported: true, sourceTitle: 'Security Book' }),
    ]);

    const [saved] = await answers();
    expect(saved).toMatchObject({
      content: text,
      status: 'COMPLETE',
      model: `google/${PRIMARY}`,
      promptVersion: 'agent-system@v4',
      invalidCitations: 0,
      tokensIn: 200,
      tokensOut: 40,
    });
    expect(saved!.toolCalls).toEqual([
      expect.objectContaining({ id: start.id, step: 1, tool: 'search_sources', ok: true }),
    ]);
    const done = events.at(-1)!.data;
    expect(done.messageId).toBe(saved!.id);
    expect(done.cached).toBe(false);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation/turn.completed',
        data: { conversationId, messageId: saved!.id },
      }),
    );
  });

  it('flags a citation number the model was never shown', async () => {
    play([{ toolCalls: [search] }, { text: 'Salts are random data [1]. They are also blue [7].' }]);

    const { events } = await ask('What is a salt?');

    const citations = events.find((e) => e.event === 'citations')!.data.items as {
      n: number;
      valid: boolean;
    }[];
    expect(citations.map(({ n, valid }) => ({ n, valid }))).toEqual([
      { n: 1, valid: true },
      { n: 7, valid: false },
    ]);
    expect((await answers())[0]!.invalidCitations).toBe(1);
  });

  it('forces an answer without tools once the steps run out', async () => {
    const models = play([
      { toolCalls: [search] },
      { toolCalls: [search] },
      { toolCalls: [search] },
      { toolCalls: [search] },
      { text: 'Here is what I found [1].' },
    ]);

    const { events } = await ask('What is a salt?');

    const calls = models[PRIMARY]!.doStreamCalls;
    expect(calls).toHaveLength(appConfig.chat.maxAgentSteps);
    expect(calls.slice(0, -1).every((call) => (call.tools?.length ?? 0) > 0)).toBe(true);
    expect(calls.at(-1)!.tools ?? []).toHaveLength(0);
    // The last step reads the tool results as text, with a note to answer now.
    expect(JSON.stringify(calls.at(-1)!.prompt)).toContain("can't call tools any more");
    expect(events.filter((e) => e.event === 'step')).toHaveLength(
      (appConfig.chat.maxAgentSteps - 1) * 2,
    );
    expect((await answers())[0]!.content).toBe('Here is what I found [1].');
  });

  it('hands a failed step to the fallback as plain text', async () => {
    const models = play(
      [{ toolCalls: [search] }, apiError(400)],
      [{ text: 'Salts are random data [1].' }],
    );

    const { events } = await ask('What is a salt?');

    expect(events.at(-1)!.event).toBe('done');
    const [fallbackCall] = models[FALLBACK]!.doStreamCalls;
    const prompt = JSON.stringify(fallbackCall!.prompt);
    expect(prompt).toContain('<tool_result tool=\\"search_sources\\"');
    expect(prompt).not.toContain('tool-call');
    const [saved] = await answers();
    expect(saved).toMatchObject({ status: 'COMPLETE', model: `groq/${FALLBACK}` });
  });

  it('saves the partial answer when the stream breaks after it started', async () => {
    play([{ text: 'Salts are ', failAfterText: apiError(500) }]);

    const { events } = await ask('What is a salt?');

    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'UPSTREAM_ERROR' } });
    const [saved] = await answers();
    expect(saved).toMatchObject({ status: 'ERROR', content: 'Salts are ' });
    expect(send).not.toHaveBeenCalled();
  });

  it('stops the model and saves an aborted answer when the client goes away', async () => {
    useModels({ [PRIMARY]: stallingStreamModel('Salts ') });
    const turn = await prepareTurnService({ id: alice.userId }, conversationId, 'What is a salt?');
    const controller = new AbortController();
    const events: TurnEvent[] = [];

    await runTurnService(
      turn,
      (event) => {
        events.push(event);
        if (event.type === 'token') controller.abort();
      },
      controller.signal,
    );

    expect(events.map((e) => e.type)).toEqual(['title', 'token']);
    const [saved] = await answers();
    expect(saved).toMatchObject({ status: 'ABORTED', content: 'Salts ' });
  });

  it("refuses someone else's conversation and empty or oversized messages", async () => {
    play([{ text: 'unused' }]);
    const bob = await signedInUser('bob@example.com');

    expect((await ask('Hi', bob)).res.status).toBe(404);
    expect((await ask('Hi', alice, MISSING_ID)).res.status).toBe(404);
    expect((await ask('   ')).res.status).toBe(400);
    expect((await ask('x'.repeat(appConfig.chat.maxMessageChars + 1))).res.status).toBe(400);
    expect(await prismaClient.message.count()).toBe(0);
  });

  it('sends earlier turns as history', async () => {
    const models = play([{ text: 'Salts are random data.' }]);
    await ask('What is a salt?');
    await ask('And a pepper?');

    const second = JSON.stringify(models[PRIMARY]!.doStreamCalls[1]!.prompt);
    expect(second).toContain('What is a salt?');
    expect(second).toContain('Salts are random data.');
    expect(second).toContain('And a pepper?');
  });

  it('keeps a step under the input budget: old history first, then old tool results', async () => {
    const chat = appConfig.chat as { maxInputTokens: number };
    const before = chat.maxInputTokens;
    // Room for the rules, the sources list and the question, not for much more.
    chat.maxInputTokens = countTokens(agentSystemPrompt.text) + 400;
    try {
      await prismaClient.message.createMany({
        data: [
          { conversationId, role: 'USER', content: 'old question', createdAt: new Date(1_000) },
          {
            conversationId,
            role: 'ASSISTANT',
            content: `old answer ${'pepper '.repeat(600)}`,
            createdAt: new Date(2_000),
          },
        ],
      });
      await seedSource(workspaceId, {
        title: 'Long Book',
        chunks: { long: { content: `salt ${'hash '.repeat(900)}`, vector: vectorOf(1) } },
      });
      const models = play([{ toolCalls: [search] }, { text: 'Done.' }]);

      await ask('What is a salt?');

      const [first, second] = models[PRIMARY]!.doStreamCalls.map((call) =>
        JSON.stringify(call.prompt),
      );
      expect(first).not.toContain('old question');
      expect(first).toContain('What is a salt?');
      expect(second).toContain('Left out to save space');
    } finally {
      chat.maxInputTokens = before;
    }
  });

  it('keeps the native tool format when the fallback takes over at the first step', async () => {
    const models = play(
      [apiError(400)],
      [{ toolCalls: [search] }, { text: 'Salts are random data [1].' }],
    );

    await ask('What is a salt?');

    const second = JSON.stringify(models[FALLBACK]!.doStreamCalls[1]!.prompt);
    expect(second).toContain('tool-result');
    expect(second).not.toContain('<tool_result tool=');
    const [saved] = await answers();
    expect(saved).toMatchObject({ status: 'COMPLETE', model: `groq/${FALLBACK}` });
    const usage = await prismaClient.usageEvent.findMany({
      where: { messageId: saved!.id, ok: true },
    });
    expect(usage.every((row) => row.fallbackUsed)).toBe(true);
  });

  it('says so when every model is out of quota', async () => {
    play([apiError(429)], [apiError(429)]);

    const { events } = await ask('What is a salt?');

    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'UPSTREAM_ERROR', message: expect.stringContaining('free-tier limit') },
    });
    expect((await answers())[0]!.error).toContain('free-tier limit');
  });

  it('treats an empty answer as a failed turn', async () => {
    play([{ text: '' }]);

    const { events } = await ask('What is a salt?');

    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'UPSTREAM_ERROR' } });
    expect((await answers())[0]!.status).toBe('ERROR');
  });

  it('drops citation numbers from earlier answers in the history', async () => {
    const models = play([{ text: 'Salts are random data [1].' }]);
    await ask('What is a salt?');
    await ask('And a pepper?');

    const second = JSON.stringify(models[PRIMARY]!.doStreamCalls[1]!.prompt);
    expect(second).toContain('Salts are random data.');
    expect(second).not.toContain('[1]');
  });
});

describe('turn options', () => {
  const run = async (
    options: Parameters<typeof runTurnService>[3],
    user: { id: string; isSystem?: boolean } = { id: alice.userId },
  ) => {
    const turn = await prepareTurnService(user, conversationId, 'What is a salt?');
    return runTurnService(turn, () => {}, new AbortController().signal, options);
  };

  it('static RAG searches once with the question, then answers without tools', async () => {
    const models = play([{ text: 'A salt is random data mixed into each password [1].' }]);

    const outcome = await run({ experiment: { staticRag: true } });

    expect(outcome).toMatchObject({ status: 'COMPLETE', forcedFinal: false, steps: 2 });
    expect(outcome.toolCalls).toEqual([
      expect.objectContaining({
        step: 1,
        tool: 'search_sources',
        args: { query: 'What is a salt?' },
      }),
    ]);
    expect(outcome.passages).toHaveLength(1);
    expect(outcome.citations).toEqual([expect.objectContaining({ n: 1, valid: true })]);
    const calls = models[PRIMARY]!.doStreamCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tools ?? []).toHaveLength(0);
    expect(JSON.stringify(calls[0]!.prompt)).toContain('<tool_result tool=\\"search_sources\\"');
  });

  it('gives the agent only the listed tools and pins one model without a fallback', async () => {
    const models = play([apiError(400)], [{ text: 'unused' }]);

    const outcome = await run({
      experiment: { tools: ['search_code', 'read_source'], models: [textRoutes.agent.primary] },
    });

    expect(outcome.status).toBe('ERROR');
    expect(models[FALLBACK]!.doStreamCalls).toHaveLength(0);
    const names = (models[PRIMARY]!.doStreamCalls[0]!.tools ?? []).map((tool) => tool.name);
    expect(names).toEqual(['search_code', 'read_source']);
    await expect(run({ experiment: { tools: ['no_such_tool'] } })).rejects.toThrow('no_such_tool');
  });

  it('renders the chosen prompt version and saves it on the answer', async () => {
    const models = play([{ text: 'Salts are random data.' }]);

    const outcome = await run({ experiment: { promptId: 'agent-system@v3' } });

    expect(outcome.promptId).toBe('agent-system@v3');
    expect(JSON.stringify(models[PRIMARY]!.doStreamCalls[0]!.prompt)).toContain(
      'Before the first call',
    );
    const [saved] = await answers();
    expect(saved!.promptVersion).toBe('agent-system@v3');
  });

  it('lets the eval user past the daily budget and sends no after-turn event for it', async () => {
    play([{ text: 'Salts are random data.' }]);
    await prismaClient.usageEvent.create({
      data: {
        userId: alice.userId,
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

    await expect(
      prepareTurnService({ id: alice.userId }, conversationId, 'What is a salt?'),
    ).rejects.toMatchObject({ statusCode: 429 });
    const outcome = await run({}, { id: alice.userId, isSystem: true });

    expect(outcome.status).toBe('COMPLETE');
    expect(send).not.toHaveBeenCalled();
  });

  it('marks both messages of a useMemory=false turn as off limits to memory', async () => {
    play([{ text: 'Salts are random data.' }]);

    await alice.agent
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .send({ content: 'What is a salt?', useMemory: false })
      .buffer(true);

    const messages = await prismaClient.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    expect(messages.map(({ role, memoryOff }) => ({ role, memoryOff }))).toEqual([
      { role: 'USER', memoryOff: true },
      { role: 'ASSISTANT', memoryOff: true },
    ]);
  });
});

describe('step events', () => {
  it('gives each call an id of its own, shared by its start and end', async () => {
    play([
      { toolCalls: [search, { name: 'search_sources', input: { query: 'a pepper' } }] },
      { text: 'Done [1].' },
    ]);

    const { events } = await ask('What is a salt?');

    const steps = events.filter((e) => e.event === 'step').map((e) => e.data);
    expect(steps.map((step) => step.status)).toEqual(['start', 'end', 'start', 'end']);
    expect(steps.map((step) => step.index)).toEqual([1, 1, 1, 1]);
    expect(steps[0]!.id).toBe(steps[1]!.id);
    expect(steps[2]!.id).toBe(steps[3]!.id);
    expect(steps[0]!.id).not.toBe(steps[2]!.id);
    const [saved] = await answers();
    expect((saved!.toolCalls as { id: string }[]).map((call) => call.id)).toEqual([
      steps[0]!.id,
      steps[2]!.id,
    ]);
  });

  it('says on the end event when the call failed', async () => {
    // search_sources needs a query: the call is refused, and the model is told so.
    play([{ toolCalls: [{ name: 'search_sources', input: {} }] }, { text: 'Sorry.' }]);

    const { events } = await ask('What is a salt?');

    const end = events.find((e) => e.event === 'step' && e.data.status === 'end')!;
    expect(end.data).toMatchObject({
      tool: 'search_sources',
      ok: false,
      summary: expect.stringContaining('Invalid arguments'),
    });
    const [saved] = await answers();
    expect(saved!.toolCalls).toEqual([expect.objectContaining({ ok: false })]);
  });
});

describe('conversation titles', () => {
  const titleOf = async (id = conversationId) =>
    (await prismaClient.conversation.findUniqueOrThrow({ where: { id } })).title;

  it('names a new conversation after the question as the turn starts, even if the answer fails', async () => {
    play([apiError(400)], [apiError(400)]);

    const { events } = await ask('What is a salt?');

    expect(events[0]).toEqual({ event: 'title', data: { title: 'What is a salt?' } });
    expect(events.at(-1)!.event).toBe('error');
    expect(await titleOf()).toBe('What is a salt?');
  });

  it('cuts a long question at a word', async () => {
    play([{ text: 'Salts are random data.' }]);

    await ask('What is a salt in a password hash? Please explain it in detail for a beginner');

    expect(await titleOf()).toBe('What is a salt in a password hash? Please explain it in…');
  });

  it('leaves a title that is already set, and names a conversation only once', async () => {
    play([{ text: 'Salts are random data.' }]);
    const named = await alice.agent
      .post(`/api/v1/workspaces/${workspaceId}/conversations`)
      .send({ title: 'My salt notes' });
    const namedId = (named.body as { data: { id: string } }).data.id;

    const own = await ask('What is a salt?', alice, namedId);
    expect(own.events.map((e) => e.event)).not.toContain('title');
    expect(await titleOf(namedId)).toBe('My salt notes');

    play([{ text: 'Salts are random data.' }]);
    await ask('What is a salt?');
    play([{ text: 'Peppers are secret.' }]);
    const again = await ask('And a pepper?');
    expect(again.events.map((e) => e.event)).not.toContain('title');
    expect(await titleOf()).toBe('What is a salt?');
  });

  it('does not name the conversations of the eval user', async () => {
    const turn = await prepareTurnService(
      { id: alice.userId, isSystem: true },
      conversationId,
      'What is a salt?',
    );

    expect(turn.titleSet).toBeNull();
    expect(await titleOf()).toBe(DEFAULT_TITLE);
  });
});

describe('retrying a question', () => {
  const messages = () =>
    prismaClient.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const brief = async () =>
    (await messages()).map(({ role, status, content }) => [role, status, content]);

  it('replaces the failed attempt instead of stacking another pair on it', async () => {
    play([apiError(400)], [apiError(400)]);
    await ask('What is a salt?');
    const failed = await messages();
    expect(failed.map((m) => m.status)).toEqual(['COMPLETE', 'ERROR']);

    play([{ toolCalls: [search] }, { text: 'A salt is random data [1].' }]);
    const { events } = await ask('What is a salt?', alice, conversationId, { retry: true });

    expect(events.at(-1)!.event).toBe('done');
    expect(await brief()).toEqual([
      ['USER', 'COMPLETE', 'What is a salt?'],
      ['ASSISTANT', 'COMPLETE', 'A salt is random data [1].'],
    ]);
    const ids = (await messages()).map((m) => m.id);
    expect(ids.some((id) => failed.some((old) => old.id === id))).toBe(false);
  });

  it('replaces a cut-off answer too, and several failures in a row leave one attempt', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      play([apiError(400)], [apiError(400)]);
      await ask('What is a salt?', alice, conversationId, { retry: attempt > 0 });
    }
    expect(await brief()).toEqual([
      ['USER', 'COMPLETE', 'What is a salt?'],
      ['ASSISTANT', 'ERROR', expect.any(String)],
    ]);

    useModels({ [PRIMARY]: stallingStreamModel('Salts ') });
    const turn = await prepareTurnService({ id: alice.userId }, conversationId, 'What is a salt?', {
      retry: true,
    });
    const controller = new AbortController();
    await runTurnService(
      turn,
      (event) => {
        if (event.type === 'token') controller.abort();
      },
      controller.signal,
    );
    expect(await brief()).toEqual([
      ['USER', 'COMPLETE', 'What is a salt?'],
      ['ASSISTANT', 'ABORTED', 'Salts '],
    ]);

    play([{ text: 'Salts are random data.' }]);
    await ask('What is a salt?', alice, conversationId, { retry: true });
    expect(await brief()).toEqual([
      ['USER', 'COMPLETE', 'What is a salt?'],
      ['ASSISTANT', 'COMPLETE', 'Salts are random data.'],
    ]);
  });

  it('keeps the failed attempt without the flag', async () => {
    play([apiError(400)], [apiError(400)]);
    await ask('What is a salt?');
    play([{ text: 'Salts are random data.' }]);
    await ask('What is a salt?');

    expect((await messages()).map((m) => m.status)).toEqual([
      'COMPLETE',
      'ERROR',
      'COMPLETE',
      'COMPLETE',
    ]);
  });

  it('is an ordinary question when the last one is a different one or was answered', async () => {
    play([apiError(400)], [apiError(400)]);
    await ask('What is a salt?');
    play([{ text: 'Peppers are secret.' }]);
    await ask('And a pepper?', alice, conversationId, { retry: true });
    expect((await messages()).map((m) => m.content)).toEqual([
      'What is a salt?',
      expect.any(String),
      'And a pepper?',
      'Peppers are secret.',
    ]);

    play([{ text: 'Peppers are secret.' }]);
    await ask('And a pepper?', alice, conversationId, { retry: true });
    expect(await messages()).toHaveLength(6);
  });

  it('shows the model the earlier turns and the question once', async () => {
    play([{ text: 'Salts are random data.' }]);
    await ask('What is a salt?');
    play([apiError(400)], [apiError(400)]);
    await ask('And a pepper?');

    const models = play([{ text: 'Peppers are secret.' }]);
    await ask('And a pepper?', alice, conversationId, { retry: true });

    const prompt = JSON.stringify(models[PRIMARY]!.doStreamCalls[0]!.prompt);
    expect(prompt).toContain('What is a salt?');
    expect(prompt).toContain('Salts are random data.');
    expect(prompt.split('And a pepper?')).toHaveLength(2);
  });

  it("does not touch someone else's conversation", async () => {
    const bob = await signedInUser('bob@example.com');
    const res = await ask('What is a salt?', bob, conversationId, { retry: true });
    expect(res.res.status).toBe(404);
  });
});
