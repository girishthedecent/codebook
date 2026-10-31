import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { buildAgentContext } from '../src/modules/chat/context.js';
import { readSource } from '../src/modules/chat/tools/readSource.js';
import { searchSources } from '../src/modules/chat/tools/searchSources.js';
import { CitationRegistry } from '../src/modules/citations/citationRegistry.js';
import { ensureDemoOwner, ensureDemoWorkspace } from '../src/modules/demo/demo.service.js';
import { excerptOf } from '../src/modules/demo/excerpt.js';
import { consume } from '../src/utils/rateLimit.js';
import { loadDemoSpec, planDemoSources } from '../prisma/seed.js';
import { loadCorpusSpec } from '../evals/corpusWorkspace.js';
import { authAgent, ORIGIN, signedInUser, signUp } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { seedSource } from './helpers/retrieval.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/llm/reranker.js', () => ({ rerank: vi.fn(), warmUpReranker: vi.fn() }));

const PAGE_ONE = `${'Replication keeps a copy of the same data on several machines. '.repeat(40)}END1`;
const PAGE_TWO = `${'A leader accepts writes and sends them to its followers. '.repeat(40)}END2`;

type Body<T> = { data: T; message: string; code: string };

async function signInGuest(agent = authAgent()) {
  const res = await agent.post('/api/auth/sign-in/anonymous').set('origin', ORIGIN).send({});
  return { agent, res };
}

/** The seeded demo: its system owner, the workspace, and a two-page book in it. */
async function seedDemo() {
  const owner = await ensureDemoOwner();
  const workspace = await ensureDemoWorkspace(owner.id, 'The demo');
  const { sourceId, ids } = await seedSource(workspace.id, {
    title: 'Demo book',
    chunks: { a: { content: 'replication keeps copies of data on several machines' } },
  });
  await prismaClient.sourceDocument.updateMany({
    where: { sourceId },
    data: { content: `${PAGE_ONE}\f${PAGE_TWO}`, pageStart: 1, pageEnd: 2 },
  });
  return { owner, workspace, sourceId, chunkId: ids.a! };
}

beforeEach(async () => {
  await resetDb();
});

describe('guest sign-in', () => {
  it('signs in through our mount and marks the user a guest', async () => {
    const { agent, res } = await signInGuest();
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();

    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect((me.body as Body<{ isGuest: boolean }>).data.isGuest).toBe(true);

    const row = await prismaClient.user.findUniqueOrThrow({
      where: { id: (res.body as { user: { id: string } }).user.id },
    });
    expect(row).toMatchObject({ isGuest: true, isAnonymous: true, isSystem: false });
  });

  it('leaves users who sign up as non-guests', async () => {
    const { agent } = await signedInUser();
    const me = await agent.get('/api/v1/me');
    expect((me.body as Body<{ isGuest: boolean }>).data.isGuest).toBe(false);
  });

  it('caps new guest accounts per IP', async () => {
    const { points } = appConfig.limits.windows.guestSignIn;
    for (let i = 0; i < points; i++) expect((await signInGuest()).res.status).toBe(200);

    const { res } = await signInGuest();
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(await prismaClient.user.count({ where: { isGuest: true } })).toBe(points);
  });

  it('moves a guest who signs up into the new account and deletes the guest', async () => {
    const { workspace } = await seedDemo();
    const { agent, res } = await signInGuest();
    const guestId = (res.body as { user: { id: string } }).user.id;
    const conversation = await agent
      .post(`/api/v1/workspaces/${workspace.id}/conversations`)
      .send({ title: 'Asked as a guest' });
    expect(conversation.status).toBe(201);

    const signedUp = await signUp(agent, 'was-a-guest@example.com');
    const userId = (signedUp.body as { user: { id: string } }).user.id;

    expect(await prismaClient.user.findUnique({ where: { id: guestId } })).toBeNull();
    const moved = await prismaClient.conversation.findMany({
      where: { workspaceId: workspace.id },
    });
    expect(moved.map((row) => row.userId)).toEqual([userId]);
    const me = await agent.get('/api/v1/me');
    expect((me.body as Body<{ id: string; isGuest: boolean }>).data).toMatchObject({
      id: userId,
      isGuest: false,
    });
  });
});

describe('GET /api/v1/demo', () => {
  it('is a 404 before the demo is seeded', async () => {
    const res = await authAgent().get('/api/v1/demo');
    expect(res.status).toBe(404);
    expect((res.body as Body<unknown>).code).toBe('NOT_FOUND');
  });

  it('shows the workspace and its sources without a session', async () => {
    const { workspace, sourceId } = await seedDemo();
    const res = await authAgent().get('/api/v1/demo');

    expect(res.status).toBe(200);
    const data = (
      res.body as Body<{ workspace: { id: string; isDemo: boolean }; sources: { id: string }[] }>
    ).data;
    expect(data.workspace).toMatchObject({ id: workspace.id, isDemo: true });
    expect(data.sources.map((source) => source.id)).toEqual([sourceId]);
  });

  it("ignores a workspace marked as demo that the demo owner doesn't own", async () => {
    const { userId } = await signedInUser();
    await prismaClient.workspace.create({ data: { userId, name: 'Fake demo', isDemo: true } });
    expect((await authAgent().get('/api/v1/demo')).status).toBe(404);
  });
});

describe('what guests can do', () => {
  it('chats in the demo workspace only', async () => {
    const { workspace } = await seedDemo();
    const other = await signedInUser('owner@example.com');
    const theirs = await prismaClient.workspace.create({
      data: { userId: other.userId, name: 'Private' },
    });
    const { agent } = await signInGuest();

    const demo = await agent.post(`/api/v1/workspaces/${workspace.id}/conversations`).send({});
    expect(demo.status).toBe(201);
    const elsewhere = await agent.post(`/api/v1/workspaces/${theirs.id}/conversations`).send({});
    expect(elsewhere.status).toBe(404);
  });

  it('reads the demo sources', async () => {
    const { sourceId } = await seedDemo();
    const { agent } = await signInGuest();
    for (const path of ['', '/toc', '/files', '/content?page=1']) {
      expect((await agent.get(`/api/v1/sources/${sourceId}${path}`)).status, path).toBe(200);
    }
  });

  it.each([
    ['create a workspace', 'post', '/api/v1/workspaces', { name: 'Mine' }],
    ['add a source', 'post', '/api/v1/workspaces/:demo/sources', { type: 'WEBSITE' }],
    ['make a study set', 'post', '/api/v1/workspaces/:demo/study', { type: 'QUIZ' }],
    ['regenerate a study set', 'post', '/api/v1/study/cmissing0000000000000000/regenerate', {}],
    ['delete a study set', 'delete', '/api/v1/study/cmissing0000000000000000', undefined],
    ['read memories', 'get', '/api/v1/memories', undefined],
  ] as const)('cannot %s (403)', async (_name, method, path, body) => {
    const { workspace } = await seedDemo();
    const { agent } = await signInGuest();
    const url = path.replace(':demo', workspace.id);
    const res = await agent[method](url).send(body);
    expect(res.status).toBe(403);
    expect((res.body as Body<unknown>).code).toBe('FORBIDDEN');
  });

  it('cannot upload a PDF to the demo', async () => {
    const { workspace } = await seedDemo();
    const { agent } = await signInGuest();
    const res = await agent
      .post(`/api/v1/workspaces/${workspace.id}/sources`)
      .set('origin', ORIGIN)
      .attach('file', Buffer.from('%PDF-1.4\n'), 'book.pdf');
    expect(res.status).toBe(403);
    expect(await prismaClient.source.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });
});

describe('the demo is read-only for everyone but its owner', () => {
  it.each([
    ['rename it', 'patch', '/api/v1/workspaces/:demo', { name: 'Mine now' }],
    ['delete it', 'delete', '/api/v1/workspaces/:demo', undefined],
    [
      'add a source',
      'post',
      '/api/v1/workspaces/:demo/sources',
      { type: 'WEBSITE', url: 'https://example.com' },
    ],
    ['delete a source', 'delete', '/api/v1/sources/:source', undefined],
    ['resync a source', 'post', '/api/v1/sources/:source/resync', {}],
    [
      'make a study set',
      'post',
      '/api/v1/workspaces/:demo/study',
      { type: 'QUIZ', sourceIds: [':source'] },
    ],
  ] as const)('a signed-up user cannot %s', async (_name, method, path, body) => {
    const { workspace, sourceId } = await seedDemo();
    const { agent } = await signedInUser();
    const fill = (text: string) => text.replace(':demo', workspace.id).replace(':source', sourceId);
    const payload = body && JSON.parse(fill(JSON.stringify(body)));

    const res = await agent[method](fill(path)).send(payload);
    expect(res.status).toBe(404);
    const after = await prismaClient.workspace.findUniqueOrThrow({
      where: { id: workspace.id },
      include: { sources: true, studyArtifacts: true },
    });
    expect(after).toMatchObject({ name: appConfig.demo.workspaceName, isDemo: true });
    expect(after.sources).toHaveLength(1);
    expect(after.studyArtifacts).toHaveLength(0);
  });
});

describe('excerpts of the demo book', () => {
  it('cuts book pages and sections to an excerpt for visitors', async () => {
    const { sourceId } = await seedDemo();
    const { agent } = await signInGuest();

    const res = await agent.get(`/api/v1/sources/${sourceId}/content?page=1`);
    const data = (res.body as Body<{ text: string; excerpt?: boolean }>).data;
    expect(data.excerpt).toBe(true);
    expect(data.text.length).toBeLessThanOrEqual(appConfig.demo.excerptChars + 1);
    expect(data.text).not.toContain('END1');
  });

  it('gives its owner whole pages', async () => {
    const { owner, sourceId } = await seedDemo();
    const { getContentService } = await import('../src/modules/sources/sourceContent.service.js');
    const content = await getContentService(owner.id, sourceId, { page: 2 }, '127.0.0.1');
    expect(content).toEqual({ page: 2, text: PAGE_TWO });
  });

  it('caps excerpt requests per IP', async () => {
    const { sourceId } = await seedDemo();
    const { agent } = await signInGuest();
    const { points } = appConfig.limits.windows.demoContent;
    // The requests come from the loopback address supertest connects from.
    const first = await agent.get(`/api/v1/sources/${sourceId}/content?page=1`);
    expect(first.status).toBe(200);
    const hit = await prismaClient.rateLimitHit.findFirstOrThrow({
      where: { key: { startsWith: 'demoContent:' } },
    });
    const ip = hit.key.slice('demoContent:'.length);
    for (let i = 1; i < points; i++) await consume('demoContent', ip);

    const res = await agent.get(`/api/v1/sources/${sourceId}/content?page=1`);
    expect(res.status).toBe(429);
  });

  it('doesn’t count or cut repository files', async () => {
    const { workspace } = await seedDemo();
    const { sourceId } = await seedSource(workspace.id, {
      type: 'GITHUB_REPO',
      title: 'repo',
      path: 'index.js',
      chunks: { a: { content: 'module.exports = 1' } },
    });
    const long = 'x'.repeat(appConfig.demo.excerptChars * 2);
    await prismaClient.sourceDocument.updateMany({
      where: { sourceId },
      data: { content: long, lineCount: 1 },
    });
    const { agent } = await signInGuest();

    const res = await agent.get(`/api/v1/sources/${sourceId}/content?path=index.js`);
    expect(res.status).toBe(200);
    expect((res.body as Body<{ lines: { text: string }[] }>).data.lines[0]!.text).toBe(long);
    expect(
      await prismaClient.rateLimitHit.count({ where: { key: { startsWith: 'demoContent:' } } }),
    ).toBe(0);
  });

  it('gives read_source an excerpt of one page on the demo', async () => {
    const { workspace, sourceId } = await seedDemo();
    const { res } = await signInGuest();
    const guestId = (res.body as { user: { id: string } }).user.id;
    const ctx = (isOwner: boolean) => ({
      userId: isOwner ? workspace.userId : guestId,
      workspaceId: workspace.id,
      isOwner,
      isGuest: !isOwner,
      registry: new CitationRegistry(),
    });

    const visitor = await readSource.execute({ sourceId, page: 1, pageEnd: 2 }, ctx(false));
    expect(visitor.text).not.toContain('END1');
    expect(visitor.text).not.toContain('A leader accepts');
    expect(visitor.text).toMatch(/short excerpts/);
    expect(visitor.summary).toMatch(/p\. 1 \(excerpt\)/);

    const owner = await readSource.execute({ sourceId, page: 1, pageEnd: 2 }, ctx(true));
    expect(owner.text).toContain('END1');
    expect(owner.text).toContain('END2');
  });

  it('cuts search hits to snippets and leaves out parents for visitors', async () => {
    const { workspace } = await seedDemo();
    const long = `replication ${'detail '.repeat(100)}TAIL`;
    await seedSource(workspace.id, {
      parents: { p: { content: `parent ${long}`, tokenCount: 300 } },
      chunks: { c: { content: long, parent: 'p' } },
    });
    const { agent } = await signInGuest();

    const res = await agent
      .post(`/api/v1/workspaces/${workspace.id}/search`)
      .send({ query: 'replication', mode: 'keyword' });
    expect(res.status).toBe(200);
    const data = (res.body as Body<{ results: { content: string }[]; parents: unknown[] }>).data;
    expect(data.results.length).toBeGreaterThan(0);
    for (const hit of data.results) expect(hit.content.length).toBeLessThanOrEqual(301);
    expect(JSON.stringify(data)).not.toContain('TAIL');
    expect(data.parents).toEqual([]);
  });
});

describe('the agent on the demo', () => {
  it('gives search_sources excerpts of the book for visitors, whole blocks otherwise', async () => {
    const { workspace } = await seedDemo();
    const section = `replication ${'section text '.repeat(100)}BOOK_TAIL`;
    const code = `replication ${'code line '.repeat(100)}REPO_TAIL`;
    await seedSource(workspace.id, {
      title: 'Long book',
      parents: { p: { content: section, tokenCount: 300 } },
      chunks: { c: { content: `replication ${'child text '.repeat(100)}`, parent: 'p' } },
    });
    await seedSource(workspace.id, {
      type: 'GITHUB_REPO',
      title: 'Repo',
      path: 'lib/replicate.js',
      parents: { p: { content: code, tokenCount: 300 } },
      chunks: { c: { content: 'replication code', parent: 'p' } },
    });
    const passages = async (isOwner: boolean) => {
      const registry = new CitationRegistry();
      await searchSources.execute(
        { query: 'replication' },
        { userId: 'u', workspaceId: workspace.id, isOwner, isGuest: false, registry },
      );
      return registry.all();
    };

    const visitor = await passages(false);
    const book = visitor.find((ref) => ref.sourceTitle === 'Long book')!;
    expect(book.text.length).toBeLessThanOrEqual(appConfig.demo.excerptChars + 1);
    expect(book.text).not.toContain('BOOK_TAIL');
    expect(visitor.find((ref) => ref.sourceTitle === 'Repo')!.text).toBe(code);

    const owner = await passages(true);
    expect(owner.find((ref) => ref.sourceTitle === 'Long book')!.text).toBe(section);
  });

  it('tells the model to quote little, for visitors only', async () => {
    const { owner, workspace } = await seedDemo();
    const { userId } = await signedInUser();
    const contextFor = async (forUser: string) => {
      const conversation = await prismaClient.conversation.create({
        data: { workspaceId: workspace.id, userId: forUser, title: 't' },
      });
      const { system } = await buildAgentContext({
        workspace,
        conversationId: conversation.id,
        questionId: 'none',
        question: 'What is replication?',
        userId: forUser,
        isGuest: false,
        useMemory: false,
      });
      return system;
    };

    expect(await contextFor(userId)).toMatch(/quote at most two short lines/);
    expect(await contextFor(owner.id)).not.toMatch(/quote at most two short lines/);
  });
});

describe('excerptOf', () => {
  it('cuts at a word boundary and marks the cut', () => {
    expect(excerptOf('one two three', 9)).toEqual({ text: 'one two…', cut: true });
    expect(excerptOf('  short  ', 9)).toEqual({ text: 'short', cut: false });
    expect(excerptOf('x'.repeat(20), 9)).toEqual({ text: `${'x'.repeat(9)}…`, cut: true });
  });
});

describe('seeding the demo', () => {
  it('finds the owner and workspace again on a rerun', async () => {
    const first = await ensureDemoOwner();
    const workspace = await ensureDemoWorkspace(first.id, 'v1');
    const again = await ensureDemoOwner();
    const sameWorkspace = await ensureDemoWorkspace(again.id, 'v2');

    expect(again.id).toBe(first.id);
    expect(sameWorkspace).toMatchObject({ id: workspace.id, isDemo: true, description: 'v2' });
    expect(await prismaClient.workspace.count()).toBe(1);
    expect(await prismaClient.user.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      isSystem: true,
      email: appConfig.demo.ownerEmail,
    });
  });

  it('refuses an owner account that can sign in', async () => {
    const agent = authAgent();
    await signUp(agent, appConfig.demo.ownerEmail);
    await expect(ensureDemoOwner()).rejects.toThrow(/has a password/);
  });

  it('keeps what is there, resyncs failures, and skips an optional source with no caches', () => {
    const corpus = loadCorpusSpec('core');
    const entry = (key: string) => corpus.sources.find((source) => source.sourceKey === key)!;
    const repo = entry('repo');
    const repoRow = {
      id: 'r1',
      type: repo.type,
      title: repo.title,
      origin: {
        owner: 'expressjs',
        repo: 'express',
        ref: repo.type === 'GITHUB_REPO' ? repo.location.ref : '',
      },
      dedupeKey: 'repo',
      status: 'FAILED' as const,
    };
    const entries = [
      { entry: entry('book'), optional: true },
      { entry: repo, optional: false },
      { entry: entry('docs'), optional: false },
    ];

    const plan = planDemoSources(entries, [repoRow], { pdfKeys: {}, cached: new Set() }, false);
    expect(plan.map((p) => [p.entry.sourceKey, p.action, p.sourceId])).toEqual([
      ['book', 'skip', undefined],
      ['repo', 'resync', 'r1'],
      ['docs', 'create', undefined],
    ]);

    const withCache = planDemoSources(
      entries,
      [{ ...repoRow, status: 'READY' }],
      { pdfKeys: {}, cached: new Set(['book']) },
      false,
    );
    expect(withCache.map((p) => p.action)).toEqual(['create', 'keep', 'create']);
    const allowed = planDemoSources(entries, [], { pdfKeys: {}, cached: new Set() }, true);
    expect(allowed[0]!.action).toBe('create');
  });

  it('reads the demo sources from demo.json: a book, a repository at a commit and a page', () => {
    const demo = loadDemoSpec();
    expect(demo.description.length).toBeGreaterThan(0);
    expect(demo.sources.map(({ entry }) => [entry.sourceKey, entry.type])).toEqual([
      ['book', 'PDF'],
      ['repo', 'GITHUB_REPO'],
      ['docs', 'WEBSITE'],
    ]);
    const repo = demo.sources[1]!.entry;
    expect(repo.type === 'GITHUB_REPO' && repo.location.ref).toMatch(/^[0-9a-f]{40}$/);
    // None needs the eval corpus's caches, so every source is required.
    expect(demo.sources.every(({ optional }) => !optional)).toBe(true);
  });
});
