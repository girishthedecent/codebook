import { beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../config/db.config.js';
import { appConfig } from '../config/app.config.js';
import { resetDb } from '../../tests/helpers/db.js';
import { rerank } from './reranker.js';

// A word-level stand-in for transformers.js: one token per word, a pair costs 3 special
// tokens, and the "model" scores a pair by how many query words the doc repeats.
const fake = vi.hoisted(() => {
  const vocab: string[] = [];
  const idOf = (word: string) => {
    let id = vocab.indexOf(word);
    if (id === -1) id = vocab.push(word) - 1;
    return id;
  };
  const split = (text: string) => text.split(/\s+/).filter(Boolean);

  const state = {
    batches: [] as string[][],
    loads: 0,
    failLoad: new Set<string>(),
    failRun: false,
  };

  function encode(
    text: string,
    {
      text_pair = null,
      add_special_tokens = true,
    }: { text_pair?: string | null; add_special_tokens?: boolean } = {},
  ) {
    const ids = [...split(text), ...(text_pair ? split(text_pair) : [])].map(idOf);
    const special = add_special_tokens ? (text_pair === null ? 2 : 3) : 0;
    return [...ids, ...Array<number>(special).fill(-1)];
  }

  const tokenizer = Object.assign(
    (queries: string[], { text_pair }: { text_pair: string[] }) => {
      state.batches.push(text_pair);
      const lengths = queries.map((query, i) => encode(query, { text_pair: text_pair[i]! }).length);
      return {
        pairs: queries.map((query, i) => [query, text_pair[i]!]),
        attention_mask: { data: lengths.flatMap((length) => Array<number>(length).fill(1)) },
      };
    },
    {
      encode,
      decode: (ids: number[]) => ids.map((id) => vocab[id]).join(' '),
    },
  );

  const model = async ({ pairs }: { pairs: [string, string][] }) => {
    if (state.failRun) throw new Error('session run failed');
    const logits = pairs.map(([query, doc]) => {
      const docWords = new Set(split(doc));
      return split(query).filter((word) => docWords.has(word)).length - 1;
    });
    return { logits: { dims: [pairs.length, 1], data: Float32Array.from(logits) } };
  };

  const load = async (id: string) => {
    state.loads++;
    if (state.failLoad.has(id)) throw new Error('no such model');
  };

  return { state, tokenizer, model, load };
});

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: {
    from_pretrained: async (id: string) => {
      await fake.load(id);
      return fake.tokenizer;
    },
  },
  AutoModelForSequenceClassification: {
    from_pretrained: async (id: string) => {
      await fake.load(id);
      return fake.model;
    },
  },
}));

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

beforeEach(async () => {
  await resetDb();
  Object.assign(fake.state, { batches: [], loads: 0, failRun: false });
  fake.state.failLoad.clear();
});

describe('rerank', () => {
  it('scores each doc with the sigmoid of its logit, in input order', async () => {
    const scores = await rerank('leader follower log', ['nothing here', 'leader log', 'leader'], {
      model: 'order-model',
    });

    expect(scores).toEqual([sigmoid(-1), sigmoid(1), sigmoid(0)]);
  });

  it('sends the docs in batches of the configured size', async () => {
    const { batchSize } = appConfig.retrieval.reranker;
    const docs = Array.from({ length: batchSize * 2 + 3 }, (_, i) => `doc ${i}`);

    const scores = await rerank('doc', docs, { model: 'batch-model' });

    expect(scores).toHaveLength(docs.length);
    expect(fake.state.batches.map((batch) => batch.length)).toEqual([batchSize, batchSize, 3]);
    expect(fake.state.batches.flat()).toEqual(docs);
  });

  it('cuts a long doc to fit, and never the query', async () => {
    const { maxTokens } = appConfig.retrieval.reranker;
    const query = 'how are writes replicated';
    const longDoc = Array.from({ length: maxTokens * 2 }, (_, i) => `w${i}`).join(' ');

    await rerank(query, [longDoc, 'short doc'], { model: 'cut-model' });

    const [sent, short] = fake.state.batches[0]!;
    expect(sent!.split(' ')).toHaveLength(maxTokens - 3 - query.split(' ').length);
    expect(longDoc.startsWith(sent!)).toBe(true);
    expect(short).toBe('short doc');
  });

  it('returns an empty list for no docs without loading the model', async () => {
    expect(await rerank('anything', [], { model: 'unused-model' })).toEqual([]);
    expect(fake.state.loads).toBe(0);
  });

  it('returns null when the model fails to load, and tries again only after a cooldown', async () => {
    fake.state.failLoad.add('broken-model');

    expect(await rerank('q', ['a'], { model: 'broken-model' })).toBeNull();
    const loads = fake.state.loads;
    expect(await rerank('q', ['a'], { model: 'broken-model' })).toBeNull();
    expect(fake.state.loads).toBe(loads);

    // The download works now, but only a call after the cooldown tries it.
    fake.state.failLoad.clear();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000);
    try {
      expect(await rerank('q', ['a'], { model: 'broken-model' })).toHaveLength(1);
      expect(fake.state.loads).toBeGreaterThan(loads);
    } finally {
      clock.mockRestore();
    }
  });

  it('returns null when a run fails, but keeps the model for the next call', async () => {
    fake.state.failRun = true;
    expect(await rerank('q', ['a'], { model: 'flaky-model' })).toBeNull();

    fake.state.failRun = false;
    expect(await rerank('q', ['q'], { model: 'flaky-model' })).toEqual([sigmoid(0)]);
  });

  it('stops when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      rerank('q', ['a'], { model: 'abort-model', signal: controller.signal }),
    ).rejects.toThrow();
  });

  it('records one usage row per call, at no cost', async () => {
    await rerank('q', ['a', 'b'], {
      model: 'usage-model',
      ctx: { userId: 'u1', workspaceId: 'w1' },
    });
    fake.state.failRun = true;
    await rerank('q', ['a'], { model: 'usage-model' });

    const rows = await prismaClient.usageEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: 'RERANK',
      task: 'rerank',
      provider: 'local',
      model: 'usage-model',
      userId: 'u1',
      workspaceId: 'w1',
      tokensIn: 10,
      tokensOut: 0,
      ok: true,
      error: null,
    });
    expect(Number(rows[0]!.costUsd)).toBe(0);
    expect(rows[1]).toMatchObject({ ok: false, error: 'Error: session run failed' });
  });
});
