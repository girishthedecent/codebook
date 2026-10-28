import type { Agent } from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import { serverConfig } from '../src/config/index.js';
import prismaClient from '../src/config/db.config.js';
import { embeddingInput } from '../src/llm/embeddings.js';
import { textRoutes } from '../src/llm/models.js';
import { rerank } from '../src/llm/reranker.js';
import { clearQueryModeMemo } from '../src/modules/retrieval/queryModes.js';
import { search } from '../src/modules/retrieval/retrieval.service.js';
import type { SearchOptions, SearchResult } from '../src/modules/retrieval/retrieval.types.js';
import { authAgent, signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import {
  apiError,
  fakeEmbeddingModel,
  fakeVector,
  textModel,
  useModels,
} from './helpers/llm-mock.js';
import { seedSource, similarTo, vectorOf } from './helpers/retrieval.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/llm/reranker.js', () => ({ rerank: vi.fn(), warmUpReranker: vi.fn() }));

// Has words the fixture chunks don't ("practice", "network", "slow"): an AND query would
// find nothing.
const QUESTION =
  'In practice, how do leaders ship their replication log to followers when the network is slow?';
const { min, weak: weakScore } =
  appConfig.retrieval.reranker.thresholds[serverConfig.RERANKER_MODEL]!;

let alice: Agent;
let aliceId: string;
let bob: Agent;
let workspaceId: string;
let bobWorkspaceId: string;
let book: Awaited<ReturnType<typeof seedSource>>;
let repo: Awaited<ReturnType<typeof seedSource>>;
let theirs: Awaited<ReturnType<typeof seedSource>>;
let doEmbed: MockInstance<typeof fakeEmbeddingModel.doEmbed>;

// The vector each query text is embedded as; anything else gets an unrelated fake vector.
const queryVectors = new Map<string, number[]>();
const embedQueryAs = (text: string, vector: number[]) =>
  queryVectors.set(embeddingInput(text, 'query'), vector);

/** Share of the query's words that appear in the doc: a stand-in for the cross-encoder. */
function wordOverlap(query: string, doc: string) {
  const words = query.toLowerCase().match(/\w+/g) ?? [];
  const text = doc.toLowerCase();
  return words.filter((word) => text.includes(word)).length / Math.max(words.length, 1);
}

/** Rerank scores picked by a phrase in the doc; docs matching none get `otherwise`. */
function rerankBy(scores: Record<string, number>, otherwise = 0) {
  vi.mocked(rerank).mockImplementation(async (_query, docs) =>
    docs.map(
      (doc) => Object.entries(scores).find(([phrase]) => doc.includes(phrase))?.[1] ?? otherwise,
    ),
  );
}

async function createWorkspace(agent: Agent, name: string) {
  const res = await agent.post('/api/v1/workspaces').send({ name });
  return (res.body as { data: { id: string } }).data.id;
}

const find = (options: Partial<SearchOptions> & { query: string }) =>
  search({ userId: aliceId, workspaceId, ...options });
const ids = (result: SearchResult) => result.results.map((chunk) => chunk.chunkId);

beforeEach(async () => {
  await resetDb();
  clearQueryModeMemo();
  ({ agent: alice, userId: aliceId } = await signedInUser('alice@example.com'));
  ({ agent: bob } = await signedInUser('bob@example.com'));
  workspaceId = await createWorkspace(alice, 'Alice');
  bobWorkspaceId = await createWorkspace(bob, 'Bob');

  book = await seedSource(workspaceId, {
    type: 'PDF',
    title: 'Replication Book',
    path: 'book.pdf',
    parents: {
      replication: {
        content: 'The whole replication section.',
        tokenCount: 300,
        headingPath: ['Replication'],
      },
      partitioning: {
        content: 'The whole partitioning section.',
        tokenCount: 300,
        headingPath: ['Partitioning'],
      },
    },
    chunks: {
      leader: {
        content: 'Leaders ship the replication log to every follower.',
        vector: similarTo(0.9),
        parent: 'replication',
        headingPath: ['Replication'],
      },
      follower: {
        content: 'Followers apply the replication log in the order it was written.',
        vector: similarTo(0.8),
        parent: 'replication',
        headingPath: ['Replication'],
      },
      partition: {
        content: 'Partitions split a large dataset by key range.',
        vector: similarTo(0.3, 2),
        parent: 'partitioning',
        headingPath: ['Partitioning'],
      },
    },
  });
  repo = await seedSource(workspaceId, {
    type: 'GITHUB_REPO',
    title: 'Users Repo',
    path: 'src/users/repository.ts',
    parents: { file: { content: 'The whole repository file.', tokenCount: 200 } },
    chunks: {
      // No vector: only keyword search can find it.
      lookup: {
        content: 'export async function findByEmail(email) { return users.get(email); }',
        searchText:
          'export async function findByEmail(email) { return users.get(email); } find by email',
        symbolName: 'findByEmail',
        parent: 'file',
      },
    },
  });
  // Bob's chunk matches every query better than anything of Alice's.
  theirs = await seedSource(bobWorkspaceId, {
    title: 'Bob Book',
    chunks: {
      secret: {
        content: `${QUESTION} Leaders ship the replication log to every follower. findByEmail`,
        searchText: `${QUESTION} leaders replication log follower findByEmail find by email`,
        vector: vectorOf(1),
      },
    },
  });

  queryVectors.clear();
  embedQueryAs(QUESTION, vectorOf(1));
  doEmbed = vi.spyOn(fakeEmbeddingModel, 'doEmbed').mockImplementation(async ({ values }) => ({
    embeddings: values.map((value) => queryVectors.get(value) ?? fakeVector(value)),
    warnings: [],
  }));
  vi.mocked(rerank).mockReset();
  vi.mocked(rerank).mockImplementation(async (query, docs) =>
    docs.map((doc) => wordOverlap(query, doc)),
  );
});

afterEach(() => {
  doEmbed.mockRestore();
});

describe('workspace isolation', () => {
  const cases = [
    ['vector', true],
    ['vector', false],
    ['keyword', true],
    ['keyword', false],
    ['hybrid', true],
    ['hybrid', false],
  ] as const;

  it.each(cases)('never returns another workspace’s chunk (%s, rerank %s)', async (mode, on) => {
    for (const query of [QUESTION, 'findByEmail']) {
      const result = await find({ query, mode, rerank: on, topK: 20 });

      expect(result.debug.ranked.length).toBeGreaterThan(0);
      expect(result.debug.ranked).not.toContain(theirs.ids.secret);
      expect(ids(result)).not.toContain(theirs.ids.secret);
      expect(result.parents.map((block) => block.sourceId)).not.toContain(theirs.sourceId);
    }
  });

  it.each(cases)(
    'keeps the sub-queries of decompose inside the workspace (%s, rerank %s)',
    async (mode, on) => {
      useModels({
        [textRoutes.rewrite.primary.model]: textModel(
          JSON.stringify({ queries: ['replication log leaders', 'findByEmail'] }),
        ),
      });

      const result = await find({ query: QUESTION, mode, rerank: on, queryMode: 'decompose' });

      expect(result.debug.queries).toEqual(['replication log leaders', 'findByEmail']);
      expect(result.debug.ranked.length).toBeGreaterThan(0);
      expect(result.debug.ranked).not.toContain(theirs.ids.secret);
    },
  );

  it("finds nothing when asked for another workspace's source", async () => {
    const result = await find({ query: QUESTION, sourceIds: [theirs.sourceId] });

    expect(result.results).toEqual([]);
    expect(result.debug.ranked).toEqual([]);
    expect(result.debug.weak).toBe(true);
  });
});

describe('when the question cannot be embedded', () => {
  beforeEach(() => {
    doEmbed.mockRejectedValue(apiError(400));
  });

  it('falls back to keyword matches in a hybrid search, marked weak', async () => {
    const result = await find({ query: 'findByEmail', mode: 'hybrid', rerank: false });

    expect(ids(result)).toContain(repo.ids.lookup);
    expect(result.debug).toMatchObject({ keywordOnly: true, weak: true });
  });

  it('still fails a vector-only search', async () => {
    await expect(find({ query: 'findByEmail', mode: 'vector', rerank: false })).rejects.toThrow(
      'Embeddings request failed',
    );
  });
});

describe('filters', () => {
  it('limits the search to the given sources', async () => {
    const result = await find({ query: 'findByEmail', sourceIds: [repo.sourceId], rerank: false });

    expect(ids(result)).toEqual([repo.ids.lookup]);
  });

  it('limits the search to the given source types', async () => {
    embedQueryAs('findByEmail', vectorOf(1));

    const pdfOnly = await find({ query: 'findByEmail', sourceTypes: ['PDF'], rerank: false });
    expect(ids(pdfOnly)).not.toContain(repo.ids.lookup);
    expect(ids(pdfOnly)).toContain(book.ids.leader);

    const repoOnly = await find({
      query: 'findByEmail',
      sourceTypes: ['GITHUB_REPO'],
      rerank: false,
    });
    expect(ids(repoOnly)).toEqual([repo.ids.lookup]);
  });

  it('matches a path prefix literally, % and _ included', async () => {
    const files = await seedSource(workspaceId, {
      type: 'GITHUB_REPO',
      title: 'Widgets',
      chunks: {
        literal: { content: 'widget one', path: 'src/100%_done/a.ts' },
        wildcard: { content: 'widget two', path: 'src/100xxdone/b.ts' },
        other: { content: 'widget three', path: 'lib/c.ts' },
      },
    });

    const result = await find({
      query: 'widget',
      mode: 'keyword',
      rerank: false,
      pathPrefix: 'src/100%_done/',
    });

    expect(ids(result)).toEqual([files.ids.literal]);
  });
});

describe('vector and keyword search', () => {
  it('finds an exact identifier only by keyword, and hybrid returns it with the vector match', async () => {
    embedQueryAs('findByEmail', vectorOf(1));

    const vector = await find({ query: 'findByEmail', mode: 'vector', rerank: false });
    expect(ids(vector)).not.toContain(repo.ids.lookup);

    const keyword = await find({ query: 'findByEmail', mode: 'keyword', rerank: false });
    expect(ids(keyword)).toEqual([repo.ids.lookup]);

    const hybrid = await find({ query: 'findByEmail', mode: 'hybrid', rerank: false });
    expect(ids(hybrid)).toContain(repo.ids.lookup);
    expect(ids(hybrid)).toContain(book.ids.leader);
  });

  it('counts the keyword list at its configured weight in the fusion', async () => {
    embedQueryAs('findByEmail', vectorOf(1));
    const { keywordWeight, rrfK } = appConfig.retrieval;

    const hybrid = await find({ query: 'findByEmail', mode: 'hybrid', rerank: false });

    // Top of the keyword list only, so its fused score is the weight alone.
    const lookup = hybrid.results.find((chunk) => chunk.chunkId === repo.ids.lookup);
    expect(lookup!.scores.rrf).toBeCloseTo(keywordWeight / (rrfK + 1));
  });

  it('finds keyword hits for a long question even though no chunk has all its words', async () => {
    const result = await find({ query: QUESTION, mode: 'keyword', rerank: false });

    expect(ids(result)).toContain(book.ids.leader);
    expect(ids(result)).toContain(book.ids.follower);
    // The chunk with more of the question's words ranks first.
    expect(ids(result)[0]).toBe(book.ids.leader);
    expect(result.results[0]!.scores.keyword).toBeGreaterThan(0);
  });

  it('searches nothing by keyword for a query of stop words, without failing', async () => {
    const keyword = await find({ query: 'the of and to', mode: 'keyword', rerank: false });
    expect(keyword.results).toEqual([]);
    expect(keyword.debug.candidates.keyword).toBe(0);
    expect(keyword.debug.weak).toBe(true);

    const hybrid = await find({ query: 'the of and to', mode: 'hybrid', rerank: false });
    expect(hybrid.debug.candidates.keyword).toBe(0);
    expect(hybrid.results.length).toBeGreaterThan(0);
  });

  it('returns the vector similarity and the citation fields of each chunk', async () => {
    const result = await find({ query: QUESTION, mode: 'vector', rerank: false });

    expect(ids(result)).toEqual([book.ids.leader, book.ids.follower, book.ids.partition]);
    expect(result.results[0]).toMatchObject({
      parentId: book.ids.replication,
      sourceId: book.sourceId,
      sourceTitle: 'Replication Book',
      sourceType: 'PDF',
      documentPath: 'book.pdf',
      headingPath: ['Replication'],
    });
    expect(result.results[0]!.scores.vector).toBeCloseTo(0.9, 5);
    expect(result.debug.rerank).toBe('off');
  });
});

describe('reranking and thresholds', () => {
  it('does not rerank unless asked to', async () => {
    const result = await find({ query: QUESTION });

    expect(result.debug.rerank).toBe('off');
    expect(rerank).not.toHaveBeenCalled();
  });

  it('reorders the candidates by rerank score', async () => {
    rerankBy({ 'Followers apply': 0.9, 'Leaders ship': 0.5 }, 0.05);

    const result = await find({ query: QUESTION, rerank: true });

    expect(ids(result).slice(0, 2)).toEqual([book.ids.follower, book.ids.leader]);
    expect(result.results[0]!.scores.rerank).toBe(0.9);
    expect(result.debug.rerank).toBe('used');
    expect(result.debug.weak).toBe(false);
    // The user's question is what the reranker compares against.
    expect(vi.mocked(rerank).mock.calls[0]![0]).toBe(QUESTION);
  });

  it('drops results below the minimum but keeps them in the ranked order', async () => {
    rerankBy({ 'Followers apply': 0.9, 'Leaders ship': 0.5 }, min / 2);

    const result = await find({ query: QUESTION, mode: 'vector', rerank: true });

    expect(ids(result)).toEqual([book.ids.follower, book.ids.leader]);
    expect(result.debug.ranked).toEqual([book.ids.follower, book.ids.leader, book.ids.partition]);
  });

  it('is weak when the best rerank score is low', async () => {
    rerankBy({ 'Leaders ship': (min + weakScore) / 2 }, min / 2);

    const result = await find({ query: QUESTION, rerank: true });

    expect(ids(result)).toEqual([book.ids.leader]);
    expect(result.debug.weak).toBe(true);
  });

  it('is weak with no results when nothing passes the minimum', async () => {
    rerankBy({}, min / 2);

    const result = await find({ query: QUESTION, rerank: true });

    expect(result.results).toEqual([]);
    expect(result.parents).toEqual([]);
    expect(result.debug.weak).toBe(true);
    expect(result.debug.ranked.length).toBeGreaterThan(0);
  });

  it('keeps the fused order when the reranker is unavailable', async () => {
    const plain = await find({ query: QUESTION, rerank: false });
    vi.mocked(rerank).mockResolvedValue(null);

    const result = await find({ query: QUESTION, rerank: true });

    expect(result.debug.rerank).toBe('unavailable');
    expect(ids(result)).toEqual(ids(plain));
    expect(result.results.every((chunk) => chunk.scores.rerank === undefined)).toBe(true);
  });

  it('skips the reranker when rerank is off', async () => {
    const result = await find({ query: QUESTION, rerank: false });

    expect(result.debug.rerank).toBe('off');
    expect(rerank).not.toHaveBeenCalled();
  });

  it('is weak without the reranker when the best vector match is far off', async () => {
    embedQueryAs('something unrelated', vectorOf(0, 0, 0, 1));

    const far = await find({ query: 'something unrelated', mode: 'vector', rerank: false });
    expect(far.results.length).toBeGreaterThan(0);
    expect(far.debug.weak).toBe(true);

    const close = await find({ query: QUESTION, mode: 'vector', rerank: false });
    expect(close.debug.weak).toBe(false);
  });
});

describe('parent expansion', () => {
  it('gives one block per parent, listing every child found in it', async () => {
    const result = await find({ query: QUESTION, mode: 'vector', rerank: false });

    expect(result.parents).toHaveLength(2);
    expect(result.parents[0]).toMatchObject({
      parentId: book.ids.replication,
      content: 'The whole replication section.',
      headingPath: ['Replication'],
      tokenCount: 300,
      childIds: [book.ids.leader, book.ids.follower],
    });
    expect(result.parents[1]).toMatchObject({
      parentId: book.ids.partitioning,
      childIds: [book.ids.partition],
    });
    expect(result.parents[0]!.score).toBeGreaterThan(result.parents[1]!.score);
  });

  it('skips blocks that would go over the token budget', async () => {
    const max = appConfig.retrieval.maxContextTokens;
    const own = await createWorkspace(alice, 'Budget');
    const big = await seedSource(own, {
      parents: {
        first: { content: 'first', tokenCount: max - 1_000 },
        second: { content: 'second', tokenCount: 2_000 },
        third: { content: 'third', tokenCount: 500 },
      },
      chunks: {
        a: { content: 'alpha', vector: similarTo(0.9), parent: 'first' },
        b: { content: 'beta', vector: similarTo(0.8), parent: 'second' },
        c: { content: 'gamma', vector: similarTo(0.7), parent: 'third' },
      },
    });

    const result = await search({
      userId: aliceId,
      workspaceId: own,
      query: QUESTION,
      mode: 'vector',
      rerank: false,
    });

    expect(result.parents.map((block) => block.parentId)).toEqual([big.ids.first, big.ids.third]);
  });

  it('always keeps the best block, even when it alone is over the budget', async () => {
    const own = await createWorkspace(alice, 'Huge');
    const huge = await seedSource(own, {
      parents: {
        huge: { content: 'huge', tokenCount: appConfig.retrieval.maxContextTokens + 1 },
        small: { content: 'small', tokenCount: 10 },
      },
      chunks: {
        a: { content: 'alpha', vector: similarTo(0.9), parent: 'huge' },
        b: { content: 'beta', vector: similarTo(0.8), parent: 'small' },
      },
    });

    const result = await search({
      userId: aliceId,
      workspaceId: own,
      query: QUESTION,
      mode: 'vector',
      rerank: false,
    });

    expect(result.parents.map((block) => block.parentId)).toEqual([huge.ids.huge]);
  });

  it('lets a child without a parent stand for itself', async () => {
    const own = await createWorkspace(alice, 'Orphans');
    const orphan = await seedSource(own, {
      chunks: { lone: { content: 'a lone chunk', vector: similarTo(0.9) } },
    });

    const result = await search({
      userId: aliceId,
      workspaceId: own,
      query: QUESTION,
      mode: 'vector',
      rerank: false,
    });

    expect(result.parents).toEqual([
      expect.objectContaining({
        parentId: orphan.ids.lone,
        content: 'a lone chunk',
        childIds: [orphan.ids.lone],
      }),
    ]);
  });

  it('returns no blocks when parent expansion is off', async () => {
    const result = await find({ query: QUESTION, expandParents: false });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.parents).toEqual([]);
  });
});

describe('POST /api/v1/workspaces/:workspaceId/search', () => {
  const searchAs = (agent: Agent, id: string, body: object) =>
    agent.post(`/api/v1/workspaces/${id}/search`).send(body);

  it('returns results, parent blocks and the debug output', async () => {
    const res = await searchAs(alice, workspaceId, { query: QUESTION, rerank: true });

    expect(res.status).toBe(200);
    const data = (res.body as { data: SearchResult }).data;
    expect(data.results[0]!.chunkId).toBe(book.ids.leader);
    expect(data.parents.length).toBeGreaterThan(0);
    expect(data.debug).toMatchObject({ rerank: 'used', weak: false });
    expect(data.debug.timings.total).toBeGreaterThanOrEqual(0);
  });

  it('reranks only when asked to', async () => {
    const res = await searchAs(alice, workspaceId, { query: QUESTION });

    expect(res.status).toBe(200);
    expect((res.body as { data: SearchResult }).data.debug.rerank).toBe('off');
    expect(rerank).not.toHaveBeenCalled();
  });

  it("uses the workspace's default search mode", async () => {
    await alice
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .send({ settings: { defaultSearchMode: 'keyword' } })
      .expect(200);

    const res = await searchAs(alice, workspaceId, { query: QUESTION });

    const data = (res.body as { data: SearchResult }).data;
    expect(data.debug.candidates.vector).toBe(0);
    expect(data.debug.candidates.keyword).toBeGreaterThan(0);
  });

  it('needs a session', async () => {
    const res = await searchAs(authAgent(), workspaceId, { query: QUESTION });
    expect(res.status).toBe(401);
  });

  it("is a 404 for someone else's workspace", async () => {
    const res = await searchAs(bob, workspaceId, { query: QUESTION });
    expect(res.status).toBe(404);
  });

  it.each([
    ['an empty query', { query: '' }],
    ['a NUL in the query', { query: 'a\0b' }],
    ['a query that is too long', { query: 'a'.repeat(appConfig.retrieval.maxQueryChars + 1) }],
    ['topK 0', { query: 'replication', topK: 0 }],
    ['topK 21', { query: 'replication', topK: 21 }],
    ['an unknown query mode', { query: 'replication', queryMode: 'magic' }],
    ['an unknown search mode', { query: 'replication', mode: 'fuzzy' }],
    ['a source id that is not an id', { query: 'replication', sourceIds: ['../x'] }],
  ])('is a 400 for %s', async (_name, body) => {
    const res = await searchAs(alice, workspaceId, body);
    expect(res.status).toBe(400);
  });

  describe('on the demo workspace', () => {
    beforeEach(async () => {
      await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });
      useModels({
        [textRoutes.rewrite.primary.model]: textModel(
          JSON.stringify({ question: 'replication log', keyTerms: ['leader'] }),
        ),
      });
    });

    it('lets anyone search without a query mode', async () => {
      const res = await searchAs(bob, workspaceId, { query: QUESTION });

      expect(res.status).toBe(200);
      expect((res.body as { data: SearchResult }).data.results.length).toBeGreaterThan(0);
    });

    it('refuses query modes to others, so they spend no model calls', async () => {
      const res = await searchAs(bob, workspaceId, { query: QUESTION, queryMode: 'rewrite' });

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toMatch(/demo/);
    });

    it('refuses reranking to others, so they spend no reranker CPU', async () => {
      const res = await searchAs(bob, workspaceId, { query: QUESTION, rerank: true });

      expect(res.status).toBe(400);
      expect(rerank).not.toHaveBeenCalled();
    });

    it('lets its owner use query modes', async () => {
      const res = await searchAs(alice, workspaceId, { query: QUESTION, queryMode: 'rewrite' });

      expect(res.status).toBe(200);
      expect((res.body as { data: SearchResult }).data.debug.queries).toContain('replication log');
    });
  });
});
