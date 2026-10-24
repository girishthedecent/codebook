import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { textRoutes } from '../src/llm/models.js';
import { defaultWebsiteTitle } from '../src/modules/sources/source.service.js';
import { allowTestAddresses } from '../src/utils/network.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { contextReply, ingest } from './helpers/ingestion.js';
import { fakeEmbeddingModel, promptModel, useModels } from './helpers/llm-mock.js';
import { CODE_BLOCK, CODE_LINES, HOME_MARKER, site } from './helpers/site.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));

let base: string;
let workspaceId: string;
let alice: Awaited<ReturnType<typeof signedInUser>>;
let doEmbed: MockInstance<typeof fakeEmbeddingModel.doEmbed>;
let prompts: string[];

beforeAll(async () => {
  allowTestAddresses(['127.0.0.1']);
  base = await site.start();
});

afterAll(async () => {
  allowTestAddresses([]);
  await site.stop();
});

beforeEach(async () => {
  await resetDb();
  site.reset();
  alice = await signedInUser('alice@example.com');
  const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Docs' });
  workspaceId = (res.body as { data: { id: string } }).data.id;
  prompts = [];
  useModels({
    [textRoutes.contextualize.primary.model]: promptModel((prompt) => {
      prompts.push(prompt);
      return contextReply(prompt);
    }),
  });
  doEmbed = vi.spyOn(fakeEmbeddingModel, 'doEmbed');
});

afterEach(() => {
  doEmbed.mockRestore();
});

/** A website source, as creating one through the API leaves it. */
async function createWebsiteSource(path = '/', maxDepth = 1, maxPages = 10) {
  const url = new URL(path, base);
  const source = await prismaClient.source.create({
    data: {
      workspaceId,
      type: 'WEBSITE',
      title: defaultWebsiteTitle(url),
      origin: { url: url.href, maxDepth, maxPages },
      dedupeKey: `web:${url.href}`,
    },
  });
  return source.id;
}

const sourceRow = (id: string) => prismaClient.source.findUniqueOrThrow({ where: { id } });
const documentsOf = (sourceId: string) =>
  prismaClient.sourceDocument.findMany({ where: { sourceId }, orderBy: { path: 'asc' } });
const childrenOf = (sourceId: string) =>
  prismaClient.sourceChunk.findMany({ where: { sourceId, kind: 'CHILD' } });

describe('ingesting a website', () => {
  it('crawls to the depth limit and respects robots.txt', async () => {
    const sourceId = await createWebsiteSource('/', 1);
    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'done' });
    const source = await sourceRow(sourceId);
    expect(source).toMatchObject({ status: 'READY', stage: 'DONE', progress: 100, error: null });
    expect(source.stats).toMatchObject({ pages: 3, skippedPages: 0, robotsBlocked: 1 });

    expect((await documentsOf(sourceId)).map((doc) => doc.path)).toEqual([
      `${base}/`,
      `${base}/about`,
      `${base}/guide`,
    ]);
    expect(site.requests('/deep')).toBe(0);
    expect(site.requests('/private/secret')).toBe(0);
    expect(site.requests('/file.pdf')).toBe(0);
    // /guide and /guide?utm_source=x are one page.
    expect(site.requests('/guide')).toBe(1);
    expect(site.requests('/robots.txt')).toBe(1);
  });

  it('goes one level deeper when the depth allows it', async () => {
    const sourceId = await createWebsiteSource('/', 2);
    await ingest(sourceId);

    expect((await documentsOf(sourceId)).map((doc) => doc.path)).toContain(`${base}/deep`);
    expect(site.requests('/private/secret')).toBe(0);
  });

  it('takes the source title from the start page', async () => {
    const sourceId = await createWebsiteSource('/', 0);
    expect((await sourceRow(sourceId)).title).toBe(defaultWebsiteTitle(new URL(base)));

    await ingest(sourceId);

    expect((await sourceRow(sourceId)).title).toBe('Fixture Docs');
  });

  it('stops at maxPages', async () => {
    const sourceId = await createWebsiteSource('/', 2, 2);
    await ingest(sourceId);

    expect(await sourceRow(sourceId)).toMatchObject({ status: 'READY' });
    expect(await documentsOf(sourceId)).toHaveLength(2);
    expect((await sourceRow(sourceId)).stats).toMatchObject({ pages: 2 });
  });

  it('stores a redirected start page under its final address', async () => {
    const sourceId = await createWebsiteSource('/redirect', 0);
    await ingest(sourceId);

    expect(await sourceRow(sourceId)).toMatchObject({ status: 'READY' });
    expect((await documentsOf(sourceId)).map((doc) => doc.path)).toEqual([`${base}/guide`]);
  });

  it('keeps a code block whole in one chunk, with the page headings as its path', async () => {
    const sourceId = await createWebsiteSource('/guide', 0);
    await ingest(sourceId);

    const children = await childrenOf(sourceId);
    const holding = children.filter((child) => child.content.includes(CODE_LINES[0]!));
    expect(holding).toHaveLength(1);
    expect(holding[0]!.content).toContain(`\`\`\`ts\n${CODE_BLOCK}\n\`\`\``);
    expect(holding[0]!.context).toMatch(/^Context \d+ of /);

    const headings = children.flatMap((child) => child.headingPath);
    expect(headings).toContain('Installing');
    expect(headings).toContain('Configuring');
    expect(holding[0]!.headingPath).toContain('Configuring');
  });

  it('serves a page by its URL through /content', async () => {
    const sourceId = await createWebsiteSource('/guide', 0);
    await ingest(sourceId);

    const res = await alice.agent
      .get(`/api/v1/sources/${sourceId}/content`)
      .query({ path: `${base}/guide`, lineStart: 1, lineEnd: 400 });
    expect(res.status).toBe(200);
    const { lines } = (res.body as { data: { lines: { text: string }[] } }).data;
    expect(lines.map((line) => line.text).join('\n')).toContain(CODE_LINES[0]!);
  });

  it('skips a resync when no page changed', async () => {
    const sourceId = await createWebsiteSource('/', 1);
    await ingest(sourceId);
    const before = await prismaClient.sourceChunk.findMany({
      where: { sourceId },
      select: { id: true },
    });
    doEmbed.mockClear();

    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'skipped' });
    expect(doEmbed).not.toHaveBeenCalled();
    const after = await prismaClient.sourceChunk.findMany({
      where: { sourceId },
      select: { id: true },
    });
    expect(after).toEqual(before);
    expect(await sourceRow(sourceId)).toMatchObject({ status: 'READY' });
  });

  it('re-indexes a changed site and caches the contexts of pages that did not change', async () => {
    const sourceId = await createWebsiteSource('/', 1);
    await ingest(sourceId);
    expect(prompts.some((prompt) => prompt.includes(HOME_MARKER))).toBe(true);
    prompts.length = 0;

    site.replace('/guide', 'Guide', '<h1>Guide</h1><p>The guide now says something new.</p>');
    site.replace('/about', 'About', null);
    const { result } = await ingest(sourceId);

    expect(result).not.toMatchObject({ outcome: 'skipped' });
    expect(result).toMatchObject({ outcome: 'done' });
    expect((await documentsOf(sourceId)).map((doc) => doc.path)).toEqual([
      `${base}/`,
      `${base}/guide`,
    ]);
    const children = await childrenOf(sourceId);
    expect(
      children.some((child) => child.content.includes('The guide now says something new')),
    ).toBe(true);
    expect(children.some((child) => child.content.includes('Installing'))).toBe(false);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((prompt) => prompt.includes(HOME_MARKER))).toBe(false);
  });

  it.each([
    ['/data.bin', /not a web page/],
    ['/private/secret', /robots\.txt/],
    ['/missing', /HTTP 404/],
  ])('fails with a message when the start page is %s', async (path, message) => {
    const sourceId = await createWebsiteSource(path, 1);
    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'failed' });
    const source = await sourceRow(sourceId);
    expect(source.status).toBe('FAILED');
    expect(source.error).toMatch(message);
    expect(await prismaClient.sourceDocument.count({ where: { sourceId } })).toBe(0);
    expect(site.requests('/private/secret')).toBe(0);
  });
});
