import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { textRoutes } from '../src/llm/models.js';
import { deletePrefix } from '../src/utils/storage.js';
import { authAgent, signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { contextReply, createPdfSource, ingest, SECTIONS } from './helpers/ingestion.js';
import { promptModel, useModels } from './helpers/llm-mock.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));

type User = Awaited<ReturnType<typeof signedInUser>>;
type TocNode = { id: string; title: string; level: number; children: TocNode[] };

let alice: User;
let bob: User;
let workspaceId: string;
let sourceId: string;
let emptySourceId: string;

// Read-only tests, so the book is ingested once for the whole file.
beforeAll(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  bob = await signedInUser('bob@example.com');
  const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Books' });
  workspaceId = (res.body as { data: { id: string } }).data.id;

  useModels({ [textRoutes.contextualize.primary.model]: promptModel(contextReply) });
  sourceId = await createPdfSource(alice.userId, workspaceId);
  await ingest(sourceId);
  emptySourceId = await createPdfSource(alice.userId, workspaceId, undefined, 'Not yet');
});

afterAll(async () => {
  await deletePrefix(`users/${alice.userId}/`);
});

const dataOf = <T>(res: { body: unknown }) => (res.body as { data: T }).data;

describe('GET /sources/:id/toc', () => {
  it('returns the table of contents as a tree', async () => {
    const res = await alice.agent.get(`/api/v1/sources/${sourceId}/toc`);
    expect(res.status).toBe(200);
    const tree = dataOf<TocNode[]>(res);
    expect(tree.map((node) => node.title)).toEqual(['Part One', ...SECTIONS.slice(6)]);
    expect(tree[0]!.children.map((node) => node.title)).toEqual(SECTIONS.slice(0, 6));
    expect(tree[0]!.children[0]).toMatchObject({
      level: 2,
      pageStart: 2,
      pageEnd: 2,
      children: [],
    });
  });

  it('is empty before the first ingest', async () => {
    const res = await alice.agent.get(`/api/v1/sources/${emptySourceId}/toc`);
    expect(dataOf(res)).toEqual([]);
  });
});

describe('GET /sources/:id/files', () => {
  it('lists the documents without their content', async () => {
    const res = await alice.agent.get(`/api/v1/sources/${sourceId}/files`);
    expect(res.status).toBe(200);
    const page = dataOf<{ items: Record<string, unknown>[]; nextCursor: string | null }>(res);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
      expect.objectContaining({ path: 'fixture.pdf', pageStart: 1, pageEnd: 13, language: null }),
    ]);
    expect(page.items[0]).not.toHaveProperty('content');
  });
});

describe('GET /sources/:id/content', () => {
  it('returns the text of one page', async () => {
    const res = await alice.agent.get(`/api/v1/sources/${sourceId}/content?page=4`);
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual({
      page: 4,
      text: expect.stringMatching(/^Topic 3\nPage 4 says the fact number 4/),
    });
  });

  it("returns a section's text, subsections included", async () => {
    const node = await prismaClient.tocNode.findFirstOrThrow({
      where: { sourceId, title: 'Part One' },
    });
    const res = await alice.agent.get(`/api/v1/sources/${sourceId}/content?tocNodeId=${node.id}`);
    expect(res.status).toBe(200);
    const body = dataOf<{ tocNode: { title: string }; text: string }>(res);
    expect(body.tocNode).toMatchObject({ title: 'Part One', pageStart: 2, pageEnd: 7 });
    expect(body.text).toMatch(/^Topic 1\n/);
    expect(body.text).toContain('Topic 6');
    expect(body.text).not.toContain('Topic 7');
    expect(body.text).not.toContain('\f');
  });

  it('cuts section text in the right place after characters outside the BMP', async () => {
    // Math italic x, as pdf.js extracts from LaTeX PDFs: 2 UTF-16 units, 1 code point.
    const content = 'Let \u{1d465} be a key.\nSection B \u{1d465}\nBody of B.\nSection C';
    const source = await prismaClient.source.create({
      data: { workspaceId, type: 'PDF', title: 'Math', origin: {}, dedupeKey: 'pdf:math' },
    });
    const document = await prismaClient.sourceDocument.create({
      data: {
        id: randomUUID(),
        sourceId: source.id,
        path: 'math.pdf',
        content,
        sizeBytes: content.length,
        hash: 'x',
      },
    });
    const node = await prismaClient.tocNode.create({
      data: {
        id: randomUUID(),
        sourceId: source.id,
        documentId: document.id,
        title: 'Section B',
        level: 1,
        ordinal: 0,
        charStart: content.indexOf('Section B'),
        charEnd: content.indexOf('Section C'),
      },
    });

    const res = await alice.agent.get(`/api/v1/sources/${source.id}/content?tocNodeId=${node.id}`);
    expect(dataOf<{ text: string }>(res).text).toBe('Section B \u{1d465}\nBody of B.\n');
  });

  it('is a 404 for a page or section the source does not have', async () => {
    const missingPage = await alice.agent.get(`/api/v1/sources/${sourceId}/content?page=99`);
    expect(missingPage.status).toBe(404);
    const otherSource = await prismaClient.tocNode.findFirstOrThrow({ where: { sourceId } });
    const wrongSource = await alice.agent.get(
      `/api/v1/sources/${emptySourceId}/content?tocNodeId=${otherSource.id}`,
    );
    expect(wrongSource.status).toBe(404);
    const notIngested = await alice.agent.get(`/api/v1/sources/${emptySourceId}/content?page=1`);
    expect(notIngested.status).toBe(404);
  });

  it('needs exactly one of page and tocNodeId', async () => {
    const node = await prismaClient.tocNode.findFirstOrThrow({ where: { sourceId } });
    for (const query of ['', `?page=1&tocNodeId=${node.id}`, '?page=0', '?tocNodeId=nope']) {
      const res = await alice.agent.get(`/api/v1/sources/${sourceId}/content${query}`);
      expect(res.status, query).toBe(400);
    }
  });
});

describe('access', () => {
  it("hides another user's source on every read route", async () => {
    for (const path of ['toc', 'files', 'content?page=1']) {
      const res = await bob.agent.get(`/api/v1/sources/${sourceId}/${path}`);
      expect(res.status, path).toBe(404);
    }
  });

  it('lets anyone signed in read the demo workspace', async () => {
    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });
    try {
      for (const path of ['toc', 'files', 'content?page=1']) {
        expect((await bob.agent.get(`/api/v1/sources/${sourceId}/${path}`)).status, path).toBe(200);
      }
    } finally {
      await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: false } });
    }
  });

  it('needs a session', async () => {
    const res = await authAgent().get(`/api/v1/sources/${sourceId}/toc`);
    expect(res.status).toBe(401);
  });
});
