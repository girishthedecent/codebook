import { isStepCount, tool } from 'ai';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import { generate, generateObject } from '../src/llm/client.js';
import { embedTexts } from '../src/llm/embeddings.js';
import { resetDb } from './helpers/db.js';

// Real provider calls, about ten in total. Run with: LIVE_TESTS=1 pnpm test tests/llm.live.test.ts
describe.skipIf(!serverConfig.LIVE_TESTS)('live providers', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    await resetDb();
  });

  it('Groq answers a text prompt', async () => {
    const { text, call } = await generate({
      task: 'cheap',
      prompt: 'Reply with the single word: pong',
    });
    expect(text.toLowerCase()).toContain('pong');
    expect(call).toMatchObject({ provider: 'groq', fallbackUsed: false });
    expect(call.tokensIn).toBeGreaterThan(0);
  });

  for (const model of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
    it(`${model} calls a tool and uses the result`, async () => {
      const add = tool({
        description: 'Adds two integers',
        inputSchema: z.object({ a: z.number().int(), b: z.number().int() }),
        execute: async ({ a, b }) => ({ sum: a + b }),
      });

      const { text, result } = await generate({
        task: 'agent',
        instructions: 'Use the add tool for arithmetic. Then state the answer.',
        prompt: 'What is 1234 + 4321?',
        tools: { add },
        stopWhen: isStepCount(3),
        modelOverride: { provider: 'groq', model },
      });

      expect(result.toolCalls.some((call) => call.toolName === 'add')).toBe(true);
      expect(text.replace(/[,\s]/g, '')).toContain('5555');
    });
  }

  it('Groq returns schema-valid structured output', async () => {
    const { object, call } = await generateObject({
      task: 'cheap',
      schema: z.object({ city: z.string(), country: z.string() }),
      prompt: 'Which city is the Eiffel Tower in? Answer as JSON.',
    });
    expect(object.city.toLowerCase()).toContain('paris');
    expect(call.provider).toBe('groq');
  });

  it('Gemini answers a text prompt', async () => {
    const { text, call } = await generate({
      task: 'judge',
      prompt: 'Reply with the single word: pong',
    });
    expect(text.toLowerCase()).toContain('pong');
    expect(call.provider).toBe('google');
  });

  it('Gemini returns schema-valid structured output', async () => {
    const { object } = await generateObject({
      task: 'judge',
      schema: z.object({ score: z.number().int().min(1).max(5), reason: z.string() }),
      prompt: 'Rate the answer "2 + 2 = 4" to "What is 2 + 2?" from 1 (wrong) to 5 (correct).',
    });
    expect(object.score).toBe(5);
  });

  it('Gemini embeds at 1536 dimensions and ranks the related passage first', async () => {
    const [query] = await embedTexts(['how do I reset my password'], { kind: 'query' });
    const [related, unrelated] = await embedTexts(
      [
        'To reset your password, open Settings and choose "Forgot password".',
        'Bananas are rich in potassium.',
      ],
      { kind: 'document', title: 'Help center' },
    );

    for (const vector of [query!, related!, unrelated!]) {
      expect(vector).toHaveLength(1536);
      expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
    }
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);
    expect(dot(query!, related!)).toBeGreaterThan(dot(query!, unrelated!));
  });

  it('wrote a usage row for every call', async () => {
    const rows = await prismaClient.usageEvent.findMany();
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.every((row) => row.ok)).toBe(true);
  });
});
