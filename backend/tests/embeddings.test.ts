import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { embedTexts, normalize } from '../src/llm/embeddings.js';
import { UpstreamError } from '../src/utils/errors/app.error.js';
import { resetDb } from './helpers/db.js';
import { apiError, fakeEmbed, fakeEmbeddingModel } from './helpers/llm-mock.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
// The real limiter would hold big inputs for minutes; these tests check how it is used.
const quota = vi.hoisted(() => ({ take: vi.fn(() => Promise.resolve()), record: vi.fn() }));
vi.mock('../src/utils/pacer.js', () => ({ createWindowLimiter: () => quota }));

let doEmbed: MockInstance<typeof fakeEmbeddingModel.doEmbed>;

beforeEach(async () => {
  await resetDb();
  doEmbed = vi.spyOn(fakeEmbeddingModel, 'doEmbed');
  quota.take.mockClear();
  quota.record.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const norm = (vector: number[]) => Math.hypot(...vector);
const sentValues = () => doEmbed.mock.calls.flatMap(([options]) => options.values);

describe('embedTexts', () => {
  it('returns one unit-length 1536-dimension vector per text, in order', async () => {
    const vectors = await embedTexts(['alpha', 'beta', 'alpha'], { kind: 'document' });

    expect(vectors).toHaveLength(3);
    for (const vector of vectors) {
      expect(vector).toHaveLength(1536);
      expect(norm(vector)).toBeCloseTo(1, 6);
    }
    expect(vectors[0]).toEqual(vectors[2]);
    expect(vectors[0]).not.toEqual(vectors[1]);
    // The repeated text is only sent once.
    expect(sentValues()).toHaveLength(2);
  });

  it('adds the task prefix for documents and queries', async () => {
    await embedTexts(['how do joins work'], { kind: 'query' });
    await embedTexts(['A join combines rows.'], { kind: 'document', title: 'SQL basics' });
    await embedTexts(['untitled text'], { kind: 'document' });

    expect(sentValues()).toEqual([
      'task: search result | query: how do joins work',
      'title: SQL basics | text: A join combines rows.',
      'title: none | text: untitled text',
    ]);
  });

  it('serves repeated texts from the cache without calling the provider', async () => {
    const first = await embedTexts(['cached text'], { kind: 'document' });
    const second = await embedTexts(['cached text'], { kind: 'document' });

    expect(doEmbed).toHaveBeenCalledOnce();
    // Stored as float4 in pgvector, so compare closely rather than exactly.
    first[0]!.forEach((value, i) => expect(second[0]![i]).toBeCloseTo(value, 6));
    expect(await prismaClient.embeddingCache.count()).toBe(1);
  });

  it('caches documents and queries separately', async () => {
    const [asDocument] = await embedTexts(['joins'], { kind: 'document' });
    const [asQuery] = await embedTexts(['joins'], { kind: 'query' });

    expect(doEmbed).toHaveBeenCalledTimes(2);
    expect(asDocument).not.toEqual(asQuery);
  });

  it('splits large inputs into batches of 40', async () => {
    const texts = Array.from({ length: 250 }, (_, i) => `text ${i}`);
    const vectors = await embedTexts(texts, { kind: 'document' });

    expect(vectors).toHaveLength(250);
    expect(doEmbed.mock.calls.map(([options]) => options.values.length)).toEqual([
      40, 40, 40, 40, 40, 40, 10,
    ]);
  });

  it('waits for the free-tier quota before each document batch', async () => {
    await embedTexts(
      Array.from({ length: 50 }, (_, i) => `text ${i}`),
      { kind: 'document' },
    );
    expect(quota.take.mock.calls).toEqual([[40], [10]]);
    expect(quota.record).not.toHaveBeenCalled();
  });

  it('counts queries against the quota without waiting', async () => {
    await embedTexts(['how do joins work'], { kind: 'query' });
    expect(quota.record).toHaveBeenCalledWith(1);
    expect(quota.take).not.toHaveBeenCalled();
  });

  it('uses batches that fit in the per-minute window', () => {
    const { batchSize, documentsPerMinute } = appConfig.llm.embeddings;
    expect(batchSize).toBeLessThanOrEqual(documentsPerMinute);
  });

  it('records one usage row with estimated tokens', async () => {
    await embedTexts(['one', 'two'], { kind: 'query', ctx: { userId: 'user-1' } });

    const rows = await prismaClient.usageEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'EMBEDDING',
      task: 'embed',
      userId: 'user-1',
      model: 'gemini-embedding-2',
      ok: true,
    });
    expect(rows[0]!.tokensIn).toBeGreaterThan(0);
    expect(rows[0]!.costUsd.isZero()).toBe(false);
  });

  it('still returns paid-for vectors when the cache write fails', async () => {
    vi.spyOn(prismaClient, '$executeRaw').mockRejectedValueOnce(new Error('db hiccup'));

    const vectors = await embedTexts(['not cached'], { kind: 'document' });

    expect(vectors[0]).toHaveLength(1536);
    expect(await prismaClient.embeddingCache.count()).toBe(0);
    const [row] = await prismaClient.usageEvent.findMany();
    expect(row).toMatchObject({ ok: true });
    expect(row!.tokensIn).toBeGreaterThan(0);
  });

  it('keeps finished batches cached when a later one fails', async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `text ${i}`);
    // The last batch (texts 120-149) fails; picked by content, not by call order.
    doEmbed.mockImplementation((options) =>
      options.values.some((value) => value.endsWith('text 120'))
        ? Promise.reject(apiError(400))
        : fakeEmbed(options),
    );

    await expect(embedTexts(texts, { kind: 'document' })).rejects.toBeInstanceOf(UpstreamError);
    expect(await prismaClient.embeddingCache.count()).toBe(120);
    const [row] = await prismaClient.usageEvent.findMany();
    expect(row).toMatchObject({ ok: false });
    expect(row?.error).toMatch(/^400/);

    // The retry only pays for the batch that failed.
    doEmbed.mockReset();
    doEmbed.mockImplementation(fakeEmbed);
    await embedTexts(texts, { kind: 'document' });
    expect(sentValues()).toHaveLength(30);
  });

  it('returns an empty list for no texts', async () => {
    expect(await embedTexts([], { kind: 'document' })).toEqual([]);
    expect(doEmbed).not.toHaveBeenCalled();
  });
});

describe('normalize', () => {
  it('scales to unit length', () => {
    expect(normalize([3, 4], 2)).toEqual([0.6, 0.8]);
  });

  it('rejects a vector of the wrong size', () => {
    expect(() => normalize([1, 2, 3], 2)).toThrow(/2-dimension/);
  });
});
