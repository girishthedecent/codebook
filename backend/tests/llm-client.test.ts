import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import { resetCircuitBreaker } from '../src/llm/circuitBreaker.js';
import { generate, generateObject } from '../src/llm/client.js';
import { textRoutes } from '../src/llm/models.js';
import { estimateCost } from '../src/llm/pricing.js';
import { UpstreamError } from '../src/utils/errors/app.error.js';
import { resetDb } from './helpers/db.js';
import {
  apiError,
  failingModel,
  hangingModel,
  scriptedModel,
  textModel,
  useModels,
} from './helpers/llm-mock.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));

const BIG = 'openai/gpt-oss-120b';
const SMALL = 'openai/gpt-oss-20b';
const FLASH = 'gemini-3.6-flash';
const LITE = 'gemini-3.5-flash-lite';

beforeEach(async () => {
  await resetDb();
  // Quota errors from one test would otherwise open a breaker for the next.
  resetCircuitBreaker();
});

afterEach(() => {
  vi.useRealTimers();
});

async function usageRows() {
  return prismaClient.usageEvent.findMany({ orderBy: { createdAt: 'asc' } });
}

describe('routing', () => {
  it('sends each task to its primary model', async () => {
    useModels({
      [BIG]: textModel('big'),
      [SMALL]: textModel('small'),
      [FLASH]: textModel('flash'),
      [LITE]: textModel('lite'),
    });

    const cases = { answer: 'big', cheap: 'small', contextualize: 'lite', judge: 'lite' } as const;
    for (const [task, expected] of Object.entries(cases)) {
      const { text, call } = await generate({ task: task as keyof typeof cases, prompt: 'hi' });
      expect(text).toBe(expected);
      expect(call.model).toBe(textRoutes[task as keyof typeof cases].primary.model);
      expect(call.fallbackUsed).toBe(false);
    }
  });

  it('uses an override alone, without falling back', async () => {
    const override = scriptedModel(['from override']);
    useModels({
      'qwen/qwen3.8-27b': override,
      [BIG]: textModel('big'),
      [FLASH]: textModel('flash'),
    });

    const { text, call } = await generate({
      task: 'answer',
      prompt: 'hi',
      modelOverride: { provider: 'groq', model: 'qwen/qwen3.8-27b' },
    });
    expect(text).toBe('from override');
    expect(call.model).toBe('qwen/qwen3.8-27b');

    useModels({ 'qwen/qwen3.8-27b': failingModel(apiError(400)), [FLASH]: textModel('flash') });
    await expect(
      generate({
        task: 'answer',
        prompt: 'hi',
        modelOverride: { provider: 'groq', model: 'qwen/qwen3.8-27b' },
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('passes instructions as the system message and applies the route settings', async () => {
    const model = textModel('ok');
    useModels({ [SMALL]: model });

    await generate({ task: 'cheap', instructions: 'Be brief.', prompt: 'hi' });

    const sent = model.doGenerateCalls[0]!;
    expect(sent.prompt[0]).toEqual({ role: 'system', content: 'Be brief.' });
    expect(sent.maxOutputTokens).toBe(textRoutes.cheap.maxOutputTokens);
    expect(sent.temperature).toBe(0);
  });
});

describe('retries and fallback', () => {
  it('retries a server error once on the same model', async () => {
    const primary = scriptedModel([apiError(503), 'second try']);
    const fallback = textModel('fallback');
    useModels({ [BIG]: primary, [FLASH]: fallback });

    const { text, call } = await generate({ task: 'answer', prompt: 'hi' });
    expect(text).toBe('second try');
    expect(call.fallbackUsed).toBe(false);
    expect(primary.doGenerateCalls).toHaveLength(2);
    expect(fallback.doGenerateCalls).toHaveLength(0);
  });

  it('falls back after one retry while a fallback is waiting, and records it', async () => {
    const primary = failingModel(apiError(503));
    useModels({ [BIG]: primary, [FLASH]: textModel('fallback') });

    const { text, call } = await generate({ task: 'answer', prompt: 'hi' });
    expect(text).toBe('fallback');
    expect(primary.doGenerateCalls).toHaveLength(2);
    expect(call).toMatchObject({ provider: 'google', model: FLASH, fallbackUsed: true });

    const [row] = await usageRows();
    expect(row).toMatchObject({ model: FLASH, fallbackUsed: true, ok: true });
  });

  it('goes to the fallback without retrying when the quota is used up', async () => {
    const primary = failingModel(apiError(429));
    useModels({ [BIG]: primary, [FLASH]: textModel('fallback') });

    const { call } = await generate({ task: 'answer', prompt: 'hi' });
    expect(call.fallbackUsed).toBe(true);
    expect(primary.doGenerateCalls).toHaveLength(1);
  });

  it('tries the same Gemini model on the backup key before the next model', async () => {
    serverConfig.GEMINI_API_KEY_2 = 'backup-key';
    try {
      const flash = scriptedModel([apiError(429), 'from backup']);
      const groq = textModel('groq');
      useModels({ [FLASH]: flash, [BIG]: groq });

      const { text, call } = await generate({ task: 'study', prompt: 'hi' });
      expect(text).toBe('from backup');
      expect(call).toMatchObject({ model: FLASH, key: 'backup', fallbackUsed: true });
      expect(groq.doGenerateCalls).toHaveLength(0);
      const rows = await usageRows();
      expect(rows.at(-1)).toMatchObject({ model: FLASH, key: 'backup', ok: true });
    } finally {
      serverConfig.GEMINI_API_KEY_2 = undefined;
    }
  });

  it('paces each attempt against the key it is about to use', async () => {
    serverConfig.GEMINI_API_KEY_2 = 'backup-key';
    try {
      useModels({ [LITE]: scriptedModel([apiError(429), 'ok']) });
      const paced: string[] = [];

      await generate({
        task: 'contextualize',
        prompt: 'hi',
        pace: async (ref) => void paced.push(ref.key ?? 'primary'),
      });
      expect(paced).toEqual(['primary', 'backup']);
    } finally {
      serverConfig.GEMINI_API_KEY_2 = undefined;
    }
  });

  it('skips the wait when retry-after is longer than the cap', async () => {
    const primary = failingModel(apiError(429, { 'retry-after': '30' }));
    useModels({ [BIG]: primary, [FLASH]: textModel('fallback') });

    const started = performance.now();
    const { call } = await generate({ task: 'answer', prompt: 'hi' });
    expect(call.fallbackUsed).toBe(true);
    expect(primary.doGenerateCalls).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('goes straight to the fallback on a client error', async () => {
    const primary = failingModel(apiError(400));
    useModels({ [BIG]: primary, [FLASH]: textModel('fallback') });

    const { call } = await generate({ task: 'answer', prompt: 'hi' });
    expect(call.fallbackUsed).toBe(true);
    expect(primary.doGenerateCalls).toHaveLength(1);
  });

  it('times out a stuck model once and falls back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const primary = hangingModel();
    useModels({ [BIG]: primary, [FLASH]: textModel('fallback') });

    const pending = generate({ task: 'answer', prompt: 'hi' });
    await vi.advanceTimersByTimeAsync(textRoutes.answer.timeoutMs);
    const { text, call } = await pending;

    expect(text).toBe('fallback');
    expect(call.fallbackUsed).toBe(true);
    expect(primary.doGenerateCalls).toHaveLength(1);
  });

  it('throws UPSTREAM_ERROR when every model fails and records the failure', async () => {
    useModels({ [BIG]: failingModel(apiError(500)), [FLASH]: failingModel(apiError(401)) });

    const error = await generate({ task: 'answer', prompt: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({
      statusCode: 502,
      code: 'UPSTREAM_ERROR',
      details: { task: 'answer' },
    });

    const [row] = await usageRows();
    expect(row).toMatchObject({ ok: false, model: FLASH, fallbackUsed: true, tokensIn: 0 });
    expect(row?.error).toMatch(/^401/);
  });

  it('has no fallback for the judge', async () => {
    useModels({
      [LITE]: failingModel(apiError(400)),
      [FLASH]: textModel('flash'),
      [BIG]: textModel('big'),
      [SMALL]: textModel('small'),
    });

    await expect(generate({ task: 'judge', prompt: 'score this' })).rejects.toBeInstanceOf(
      UpstreamError,
    );
    const [row] = await usageRows();
    expect(row).toMatchObject({ ok: false, model: LITE, fallbackUsed: false });
  });

  it('stops without a fallback when the caller aborts', async () => {
    const fallback = textModel('fallback');
    useModels({ [BIG]: hangingModel(), [FLASH]: fallback });
    const controller = new AbortController();

    const pending = generate({ task: 'answer', prompt: 'hi', abortSignal: controller.signal });
    controller.abort(new Error('client went away'));

    await expect(pending).rejects.toThrow('client went away');
    expect(fallback.doGenerateCalls).toHaveLength(0);
    const [row] = await usageRows();
    expect(row).toMatchObject({ ok: false, model: BIG, fallbackUsed: false });
  });
});

describe('usage', () => {
  it('records tokens, cost and the caller on success', async () => {
    useModels({ [SMALL]: textModel('ok', { input: 1_200, output: 300, cached: 200 }) });

    const { call } = await generate({
      task: 'cheap',
      prompt: 'hi',
      ctx: { userId: 'user-1', workspaceId: 'ws-1' },
    });

    const expectedCost = estimateCost(SMALL, {
      tokensIn: 1_200,
      tokensOut: 300,
      tokensCached: 200,
    });
    expect(call.costUsd.equals(expectedCost)).toBe(true);

    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'LLM',
      task: 'cheap',
      userId: 'user-1',
      workspaceId: 'ws-1',
      provider: 'groq',
      model: SMALL,
      tokensIn: 1_200,
      tokensOut: 300,
      tokensCached: 200,
      ok: true,
      error: null,
    });
    expect(rows[0]?.costUsd.equals(expectedCost)).toBe(true);
  });
});

describe('generateObject', () => {
  const schema = z.object({ score: z.number().int().min(1).max(5) });

  it('returns the parsed object', async () => {
    useModels({ [LITE]: textModel('{"score":4}') });
    const { object } = await generateObject({ task: 'judge', schema, prompt: 'score' });
    expect(object).toEqual({ score: 4 });
  });

  it('falls back when the output does not match the schema', async () => {
    const primary = textModel('{"score":"great"}');
    useModels({ [BIG]: primary, [FLASH]: textModel('{"score":5}') });

    const { object, call } = await generateObject({ task: 'answer', schema, prompt: 'score' });
    expect(object).toEqual({ score: 5 });
    expect(call.fallbackUsed).toBe(true);
    expect(primary.doGenerateCalls).toHaveLength(1);
  });

  it('counts the tokens the rejected attempt used, priced at its own model', async () => {
    useModels({
      [BIG]: textModel('{"score":"great"}', { input: 1_000, output: 100 }),
      [FLASH]: textModel('{"score":5}', { input: 500, output: 50 }),
    });

    const { call } = await generateObject({ task: 'answer', schema, prompt: 'score' });

    expect(call).toMatchObject({ tokensIn: 1_500, tokensOut: 150 });
    const expected = estimateCost(BIG, { tokensIn: 1_000, tokensOut: 100, tokensCached: 0 }).add(
      estimateCost(FLASH, { tokensIn: 500, tokensOut: 50, tokensCached: 0 }),
    );
    expect(call.costUsd.equals(expected)).toBe(true);
  });
});
