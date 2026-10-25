import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import {
  findCachedEmbeddings,
  saveCachedEmbeddings,
} from '../src/llm/embeddingCache.repository.js';
import { saveContexts } from '../src/modules/ingestion/ingestion.repository.js';
import { resetDb } from '../tests/helpers/db.js';
import { seedSource } from '../tests/helpers/retrieval.js';
import { corpusCacheKeys, exportCache, importCache } from './cacheFile.js';
import { ensureEvalUser, ensureEvalWorkspace, loadCorpusSpec } from './corpusWorkspace.js';

const vector = (seed: number) =>
  Array.from({ length: 1536 }, (_, i) => Math.sin(seed * 1000 + i) / 7);

const dir = await mkdtemp(join(tmpdir(), 'codebook-cache-'));

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
});

describe('cache file', () => {
  it('round-trips embeddings exactly, and contexts, through a file', async () => {
    await saveCachedEmbeddings([
      { key: 'emb-a', embedding: vector(1) },
      { key: 'emb-b', embedding: vector(2) },
    ]);
    const contexts = [
      { key: 'ctx-b', context: 'Routing guide, "Route methods": one handler per verb.' },
      { key: 'ctx-a', context: 'From lib/router/index.js: matching a request to its layer.' },
    ];
    await saveContexts(contexts);
    // What pgvector stored (float32), which is what the file must give back.
    const before = await findCachedEmbeddings(['emb-a', 'emb-b']);

    const file = join(dir, 'nested', 'cache.jsonl.gz');
    const written = await exportCache(file, { embeddings: ['emb-b', 'emb-a', 'emb-a'], contexts });
    expect(written).toEqual({ embeddings: 2, contexts: 2 });

    await resetDb();
    await expect(importCache(file)).resolves.toEqual({ embeddings: 2, contexts: 2 });

    const after = await findCachedEmbeddings(['emb-a', 'emb-b']);
    expect(after.get('emb-a')).toEqual(before.get('emb-a'));
    expect(after.get('emb-b')).toEqual(before.get('emb-b'));
    const rows = await prismaClient.contextCache.findMany({ orderBy: { key: 'asc' } });
    expect(rows.map(({ key, context }) => ({ key, context }))).toEqual([contexts[1], contexts[0]]);
  });

  it('refuses to write a file with an embedding missing', async () => {
    await saveCachedEmbeddings([{ key: 'emb-a', embedding: vector(1) }]);
    const file = join(dir, 'incomplete.jsonl.gz');
    await expect(
      exportCache(file, { embeddings: ['emb-a', 'emb-missing'], contexts: [] }),
    ).rejects.toThrow(/1 of 2 embeddings are not cached/);
    expect(existsSync(file)).toBe(false);
  });

  it('leaves rows already in the caches as they are', async () => {
    await saveCachedEmbeddings([{ key: 'emb-a', embedding: vector(1) }]);
    await saveContexts([{ key: 'ctx-a', context: 'the file version' }]);
    const file = join(dir, 'existing.jsonl.gz');
    await exportCache(file, {
      embeddings: ['emb-a'],
      contexts: [{ key: 'ctx-a', context: 'the file version' }],
    });

    await resetDb();
    await saveCachedEmbeddings([{ key: 'emb-a', embedding: vector(3) }]);
    await saveContexts([{ key: 'ctx-a', context: 'already here' }]);
    const kept = (await findCachedEmbeddings(['emb-a'])).get('emb-a');
    await importCache(file);

    expect((await findCachedEmbeddings(['emb-a'])).get('emb-a')).toEqual(kept);
    const [row] = await prismaClient.contextCache.findMany();
    expect(row!.context).toBe('already here');
  });
});

describe('corpusCacheKeys', () => {
  const spec = loadCorpusSpec('core');
  const title = (key: string) => spec.sources.find((source) => source.sourceKey === key)!.title;

  /** The gate workspace with the repository and the docs page, each with one chunk. */
  async function gateCorpus(contexts: { repo: string | null; docs: string | null }) {
    const user = await ensureEvalUser();
    const workspace = await ensureEvalWorkspace(user.id, 'core', 'gate');
    const repo = await seedSource(workspace.id, {
      type: 'GITHUB_REPO',
      title: title('repo'),
      chunks: { route: { content: 'Router.prototype.route = function route(path) {}' } },
    });
    const docs = await seedSource(workspace.id, {
      type: 'WEBSITE',
      title: title('docs'),
      chunks: { methods: { content: 'Route methods are derived from the HTTP methods.' } },
    });
    await prismaClient.source.update({
      where: { id: repo.sourceId },
      data: {
        origin: {
          owner: 'expressjs',
          repo: 'express',
          ref: '1c6f1b0fe4000977b9a7b4f34097e4d527dd9824',
        },
      },
    });
    await prismaClient.source.update({
      where: { id: docs.sourceId },
      data: { origin: { url: 'https://expressjs.com/en/guide/routing.html' } },
    });
    await prismaClient.sourceChunk.update({
      where: { id: repo.ids.route },
      data: { context: contexts.repo },
    });
    await prismaClient.sourceChunk.update({
      where: { id: docs.ids.methods },
      data: { context: contexts.docs },
    });
  }

  it("lists the gate sources' chunk embeddings and their cached contexts", async () => {
    await gateCorpus({ repo: 'The router.', docs: 'The routing guide.' });
    await saveContexts([
      { key: 'k-repo', context: 'The router.' },
      { key: 'k-docs', context: 'The routing guide.' },
      { key: 'k-other', context: 'Something else entirely.' },
    ]);

    const keys = await corpusCacheKeys('core', 'gate', ['gate']);
    expect(keys.chunks).toBe(2);
    expect(keys.embeddings).toHaveLength(2);
    expect(keys.contexts.map((row) => row.key)).toEqual(['k-docs', 'k-repo']);
  });

  it('fails when a chunk has no context', async () => {
    await gateCorpus({ repo: 'The router.', docs: null });
    await saveContexts([{ key: 'k-repo', context: 'The router.' }]);
    await expect(corpusCacheKeys('core', 'gate', ['gate'])).rejects.toThrow(
      /1 of 2 chunks have no context/,
    );
  });

  it("fails when a chunk's context isn't in the context cache", async () => {
    await gateCorpus({ repo: 'The router.', docs: 'The routing guide.' });
    await saveContexts([{ key: 'k-repo', context: 'The router.' }]);
    await expect(corpusCacheKeys('core', 'gate', ['gate'])).rejects.toThrow(
      /1 chunk contexts are not in the context cache/,
    );
  });
});
