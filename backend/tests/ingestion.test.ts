import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { textRoutes } from '../src/llm/models.js';
import {
  contextualizeStep,
  failIngestService,
  ingestHash,
} from '../src/modules/ingestion/ingestion.service.js';
import { deletePrefix } from '../src/utils/storage.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { contextReply, createPdfSource, ingest, SECTIONS } from './helpers/ingestion.js';
import {
  apiError,
  fakeEmbed,
  fakeEmbeddingModel,
  promptModel,
  useModels,
} from './helpers/llm-mock.js';
import { buildPdf } from './helpers/pdf.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));

const CONTEXT_MODEL = textRoutes.contextualize.primary.model;

type User = Awaited<ReturnType<typeof signedInUser>>;
let alice: User;
let workspaceId: string;
let contextCalls: number;
let doEmbed: MockInstance<typeof fakeEmbeddingModel.doEmbed>;
const usedUsers: string[] = [];

const contextModel = () =>
  promptModel((prompt) => {
    contextCalls++;
    return contextReply(prompt);
  });

beforeEach(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  usedUsers.push(alice.userId);
  const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Books' });
  workspaceId = (res.body as { data: { id: string } }).data.id;
  contextCalls = 0;
  useModels({ [CONTEXT_MODEL]: contextModel() });
  doEmbed = vi.spyOn(fakeEmbeddingModel, 'doEmbed');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const userId of new Set(usedUsers)) await deletePrefix(`users/${userId}/`);
});

const pdfSource = (file?: Buffer, title?: string) =>
  createPdfSource(alice.userId, workspaceId, file, title);

const sourceRow = (id: string) => prismaClient.source.findUniqueOrThrow({ where: { id } });
const chunkIds = async (sourceId: string) =>
  (await prismaClient.sourceChunk.findMany({ where: { sourceId }, orderBy: { id: 'asc' } })).map(
    (chunk) => chunk.id,
  );
const childrenWithoutEmbedding = async (sourceId: string) => {
  const [row] = await prismaClient.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM "SourceChunk"
    WHERE "sourceId" = ${sourceId} AND kind = 'CHILD' AND embedding IS NULL
  `;
  return row!.count;
};

describe('ingesting a PDF', () => {
  it('builds the TOC, parent and child chunks with contexts and embeddings', async () => {
    const sourceId = await pdfSource();
    const { result, error } = await ingest(sourceId);
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'done' });

    const source = await sourceRow(sourceId);
    expect(source).toMatchObject({ status: 'READY', stage: 'DONE', progress: 100, error: null });
    expect(source.lastIngestedAt).not.toBeNull();
    expect(source.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const toc = await prismaClient.tocNode.findMany({
      where: { sourceId },
      orderBy: { ordinal: 'asc' },
    });
    expect(toc.map((node) => node.title)).toEqual(['Part One', ...SECTIONS]);
    const part = toc[0]!;
    expect(toc.slice(1, 7).every((node) => node.parentId === part.id && node.level === 2)).toBe(
      true,
    );
    expect(toc.slice(7).every((node) => node.parentId === null)).toBe(true);
    expect(toc[1]).toMatchObject({ pageStart: 2, pageEnd: 2 });

    const parents = await prismaClient.sourceChunk.findMany({
      where: { sourceId, kind: 'PARENT' },
      orderBy: { ordinal: 'asc' },
    });
    const children = await prismaClient.sourceChunk.findMany({
      where: { sourceId, kind: 'CHILD' },
      orderBy: { ordinal: 'asc' },
    });
    // The cover page is its own section before the first outline entry.
    expect(parents).toHaveLength(13);
    expect(children).toHaveLength(13);
    expect(await childrenWithoutEmbedding(sourceId)).toBe(0);
    const parentIds = new Set(parents.map((parent) => parent.id));
    for (const child of children) {
      expect(parentIds.has(child.parentId!)).toBe(true);
      expect(child.context).toMatch(/^Context 1 of /);
      expect(child.searchText.startsWith(`${child.context}\n`)).toBe(true);
      expect(child.workspaceId).toBe(workspaceId);
      expect(child.pageStart).toBe(child.pageEnd);
    }
    const topic3 = children.find((child) => child.content.startsWith('Topic 3'))!;
    expect(topic3).toMatchObject({ pageStart: 4, headingPath: ['Part One', 'Topic 3'] });
    expect(topic3.context).toBe('Context 1 of Part One > Topic 3.');
    expect(parents.every((parent) => parent.searchText === '' && parent.context === null)).toBe(
      true,
    );

    expect(source.stats).toMatchObject({
      pages: 13,
      documents: 1,
      parentChunks: 13,
      chunks: 13,
      missingContexts: 0,
    });
    expect(await prismaClient.ingestDraft.count()).toBe(0);
    // One call per parent.
    expect(contextCalls).toBe(13);
  });

  it('skips a resync when nothing changed, without any model calls', async () => {
    const sourceId = await pdfSource();
    await ingest(sourceId);
    const before = await chunkIds(sourceId);
    contextCalls = 0;
    doEmbed.mockClear();
    await prismaClient.source.update({ where: { id: sourceId }, data: { status: 'PENDING' } });

    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'skipped' });
    expect(contextCalls).toBe(0);
    expect(doEmbed).not.toHaveBeenCalled();
    expect(await chunkIds(sourceId)).toEqual(before);
    expect(await sourceRow(sourceId)).toMatchObject({ status: 'READY', stage: 'DONE' });
  });

  it('reuses cached contexts and vectors when a source is indexed again', async () => {
    const sourceId = await pdfSource();
    await ingest(sourceId);
    const before = await chunkIds(sourceId);
    contextCalls = 0;
    doEmbed.mockClear();
    // As if the pipeline version had changed: the hash no longer matches.
    await prismaClient.source.update({ where: { id: sourceId }, data: { contentHash: null } });

    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'done' });
    expect(contextCalls).toBe(0);
    expect(doEmbed).not.toHaveBeenCalled();
    const after = await chunkIds(sourceId);
    expect(after).toHaveLength(before.length);
    expect(after).not.toEqual(before);
    expect(await childrenWithoutEmbedding(sourceId)).toBe(0);
  });

  it('indexes without contexts when the model fails, and fills them in on the next run', async () => {
    useModels({ [CONTEXT_MODEL]: promptModel(() => (contextCalls++, apiError(400))) });
    const sourceId = await pdfSource();

    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'done', missingContexts: 13 });
    // The whole first batch failed, so the second batch wasn't tried.
    expect(contextCalls).toBe(10);
    expect(await childrenWithoutEmbedding(sourceId)).toBe(0);
    const children = await prismaClient.sourceChunk.findMany({
      where: { sourceId, kind: 'CHILD' },
    });
    expect(children.every((child) => child.context === null)).toBe(true);
    expect(children.every((child) => !child.searchText.startsWith('Context'))).toBe(true);
    expect(await sourceRow(sourceId)).toMatchObject({ status: 'READY' });

    useModels({ [CONTEXT_MODEL]: contextModel() });
    contextCalls = 0;
    const again = await ingest(sourceId);
    expect(again.result).toMatchObject({ outcome: 'done', missingContexts: 0 });
    expect(contextCalls).toBe(13);
  });

  it('embeds a search text that changed after the embed steps ran', async () => {
    useModels({ [CONTEXT_MODEL]: promptModel(() => apiError(400)) });
    const sourceId = await pdfSource();
    // While the embed step runs, contexts for the first ten parents appear in the cache, as
    // when another source of the same book is contextualized at the same time.
    doEmbed.mockImplementationOnce(async (options) => {
      useModels({ [CONTEXT_MODEL]: contextModel() });
      const draft = await prismaClient.ingestDraft.findUniqueOrThrow({ where: { sourceId } });
      await contextualizeStep(sourceId, draft.runId, 0);
      return fakeEmbed(options);
    });

    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'done', missingContexts: 3 });
    expect(await childrenWithoutEmbedding(sourceId)).toBe(0);
    const withContext = await prismaClient.sourceChunk.count({
      where: { sourceId, kind: 'CHILD', NOT: { context: null } },
    });
    expect(withContext).toBe(10);
  });

  it('keeps the previous index when a resync fails, and marks the source FAILED', async () => {
    const sourceId = await pdfSource();
    await ingest(sourceId);
    const before = await chunkIds(sourceId);
    await prismaClient.source.update({ where: { id: sourceId }, data: { contentHash: null } });
    await prismaClient.embeddingCache.deleteMany();
    doEmbed.mockRejectedValue(apiError(400));

    const { error } = await ingest(sourceId);
    expect(error).toBeDefined();
    // Inngest calls onFailure once its retries run out.
    const draft = await prismaClient.ingestDraft.findUniqueOrThrow({ where: { sourceId } });
    await failIngestService(sourceId, draft.runId, new Date());

    const source = await sourceRow(sourceId);
    expect(source.status).toBe('FAILED');
    expect(source.error).toMatch(/^Creating embeddings failed/);
    expect(await chunkIds(sourceId)).toEqual(before);
    expect(await prismaClient.ingestDraft.count()).toBe(0);
  });

  it('leaves the source alone when a newer run owns the draft', async () => {
    const sourceId = await pdfSource();
    useModels({
      [CONTEXT_MODEL]: promptModel(() => {
        // A second run takes over while the first is contextualizing.
        void prismaClient.ingestDraft
          .update({ where: { sourceId }, data: { runId: 'newer-run' } })
          .then();
        return JSON.stringify({ contexts: [] });
      }),
    });

    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'stopped' });
    expect(await chunkIds(sourceId)).toEqual([]);
    // The newer run's draft survives the stale run's failure handler too.
    await failIngestService(sourceId, 'stale-run', new Date());
    expect(await sourceRow(sourceId)).toMatchObject({ status: 'PROCESSING' });
    expect(await prismaClient.ingestDraft.count()).toBe(1);
  });

  it('ignores the failure of a run queued before the last successful ingest', async () => {
    const sourceId = await pdfSource();
    const queued = new Date(Date.now() - 60_000);
    await ingest(sourceId);

    // An older run that never got as far as a draft gives up now.
    await failIngestService(sourceId, 'older-run', queued);

    expect(await sourceRow(sourceId)).toMatchObject({ status: 'READY', error: null });
  });

  it('fails PDFs without text or that cannot be read, without calling a model', async () => {
    const scanned = await pdfSource(buildPdf({ pages: ['', '', ''], imageOnly: true }), 'Scan');
    const broken = await pdfSource(Buffer.from('%PDF-1.7\nnot a real pdf'), 'Broken');

    for (const [sourceId, message] of [
      [scanned, /no text layer/],
      [broken, /^Could not read this PDF$/],
    ] as const) {
      const { result } = await ingest(sourceId);
      expect(result).toMatchObject({ outcome: 'failed' });
      const source = await sourceRow(sourceId);
      expect(source.status).toBe('FAILED');
      expect(source.error).toMatch(message);
      expect(await chunkIds(sourceId)).toEqual([]);
    }
    expect(contextCalls).toBe(0);
    expect(doEmbed).not.toHaveBeenCalled();
  });

  it('fails sources whose file is missing from storage', async () => {
    const sourceId = await pdfSource();
    const { origin } = await sourceRow(sourceId);
    await prismaClient.source.update({
      where: { id: sourceId },
      data: {
        origin: {
          ...(origin as object),
          storageKey: `${(origin as { storageKey: string }).storageKey}.gone`,
        },
      },
    });

    await ingest(sourceId);

    expect((await sourceRow(sourceId)).error).toMatch(/file is missing/);
  });

  it('fails a website whose address became private after it was added', async () => {
    const source = await prismaClient.source.create({
      data: {
        workspaceId,
        type: 'WEBSITE',
        title: '10.0.0.1',
        origin: { url: 'http://10.0.0.1/', maxDepth: 0, maxPages: 10 },
        dedupeKey: 'web:http://10.0.0.1/',
      },
    });

    const { result } = await ingest(source.id);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect((await sourceRow(source.id)).error).toMatch(/private or reserved/);
  });

  it('stops quietly when the source was deleted', async () => {
    const sourceId = await pdfSource();
    await prismaClient.source.delete({ where: { id: sourceId } });

    const { result, error } = await ingest(sourceId);

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'gone' });
  });

  it('stops quietly when the source is deleted mid-run', async () => {
    const sourceId = await pdfSource();
    useModels({
      [CONTEXT_MODEL]: promptModel(() => {
        void prismaClient.source.deleteMany({ where: { id: sourceId } }).then();
        return JSON.stringify({ contexts: [] });
      }),
    });

    const { result, error } = await ingest(sourceId);

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'stopped' });
    expect(await prismaClient.sourceChunk.count()).toBe(0);
  });
});

describe('ingestHash', () => {
  it("hasn't changed for PDFs, so indexed books keep taking the skip path", () => {
    // Pinned when repositories were added: a change here re-indexes every PDF on resync.
    expect(ingestHash('Book', ['page one\fpage two'])).toBe(
      '6eb5c6228b56208de4ad12054c2f30d3caf1c07db379fa29841d649b5f8b30da',
    );
  });

  it('is stable, and changes with the title and with the content', () => {
    const base = ingestHash('Book', ['page one\fpage two']);
    expect(ingestHash('Book', ['page one\fpage two'])).toBe(base);
    expect(ingestHash('Other book', ['page one\fpage two'])).not.toBe(base);
    expect(ingestHash('Book', ['page one\fpage 2'])).not.toBe(base);
    expect(ingestHash('Book', ['page one', 'page two'])).not.toBe(base);
  });
});
