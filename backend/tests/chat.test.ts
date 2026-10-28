import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { inngest } from '../src/config/inngest.config.js';
import { resetCircuitBreaker } from '../src/llm/circuitBreaker.js';
import { textRoutes } from '../src/llm/models.js';
import { agentSystemPrompt } from '../src/llm/prompts/agentSystem.js';
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

async function ask(content: string, user = alice, id = conversationId) {
  const res = await user.agent
    .post(`/api/v1/conversations/${id}/messages`)
    .send({ content })
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
    expect(kinds.slice(0, 2)).toEqual(['step', 'step']);
    expect(kinds).toContain('token');
    expect(kinds.slice(-2)).toEqual(['citations', 'done']);
    expect(events[0]!.data).toMatchObject({ index: 1, tool: 'search_sources', status: 'start' });
    expect(events[1]!.data).toMatchObject({ index: 1, tool: 'search_sources', status: 'end' });

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
      expect.objectContaining({ step: 1, tool: 'search_sources', ok: true }),
    ]);
    const done = events.at(-1)!.data;
    expect(done.messageId).toBe(saved!.id);
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

    expect(events.map((e) => e.type)).toEqual(['token']);
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
