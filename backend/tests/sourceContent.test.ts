import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { textRoutes } from '../src/llm/models.js';
import { deletePrefix } from '../src/utils/storage.js';
import { authAgent, signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { downloadTarball, resolveCommit } from '../src/utils/github.js';
import {
  codeContextReply,
  contextReply,
  createPdfSource,
  createRepoSource,
  ingest,
  SECTIONS,
} from './helpers/ingestion.js';
import { promptModel, useModels } from './helpers/llm-mock.js';
import { buildTarball, FIXTURE_FILES, fixtureRepoEntries } from './helpers/repo.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));
vi.mock('../src/utils/github.js', () => ({
  resolveCommit: vi.fn(),
  downloadTarball: vi.fn(),
}));

type User = Awaited<ReturnType<typeof signedInUser>>;
type TocNode = { id: string; title: string; level: number; children: TocNode[] };

let alice: User;
let bob: User;
let workspaceId: string;
let sourceId: string;
let emptySourceId: string;
let repoId: string;

// A long file, to page through lines.
const LONG_FILE = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

// Read-only tests, so the book is ingested once for the whole file.
beforeAll(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  bob = await signedInUser('bob@example.com');
  const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Books' });
  workspaceId = (res.body as { data: { id: string } }).data.id;

  // One model for both prompts: the code prompt has no "Section:" line.
  useModels({
    [textRoutes.contextualize.primary.model]: promptModel((prompt) =>
      prompt.includes('<file path=') ? codeContextReply(prompt) : contextReply(prompt),
    ),
  });
  sourceId = await createPdfSource(alice.userId, workspaceId);
  await ingest(sourceId);
  emptySourceId = await createPdfSource(alice.userId, workspaceId, undefined, 'Not yet');

  const files = { ...FIXTURE_FILES, 'src/long.txt': LONG_FILE, 'src/empty.ts': '' };
  vi.mocked(resolveCommit).mockResolvedValue({ sha: 'c'.repeat(40) });
  vi.mocked(downloadTarball).mockImplementation(
    async () => new Response(buildTarball(fixtureRepoEntries(files))).body!,
  );
  repoId = await createRepoSource(workspaceId);
  await ingest(repoId);
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

describe('repository files', () => {
  type FileRow = { path: string; skippedReason: string | null; lineCount: number | null };
  const listFiles = async (query = '') => {
    const res = await alice.agent.get(`/api/v1/sources/${repoId}/files${query}`);
    expect(res.status).toBe(200);
    return dataOf<{ items: FileRow[]; nextCursor: string | null }>(res);
  };

  it('lists kept and skipped files in path order, page by page', async () => {
    const all: FileRow[] = [];
    let cursor: string | null = null;
    do {
      const page = await listFiles(`?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.items.length).toBeLessThanOrEqual(3);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    const paths = all.map((file) => file.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain('node_modules/');
    expect(all.find((file) => file.path === '.env')).toMatchObject({
      skippedReason: 'secret file',
    });
    expect(all.find((file) => file.path === 'src/long.txt')).toMatchObject({
      skippedReason: null,
      lineCount: 450,
    });
  });

  it('filters by a literal path prefix', async () => {
    const page = await listFiles('?prefix=src/');
    expect(page.items.map((file) => file.path)).toEqual([
      'src/auth/service.ts',
      'src/empty.ts',
      'src/long.txt',
      'src/util.py',
    ]);
    // "_" and "%" are not wildcards.
    expect((await listFiles('?prefix=s_c/')).items).toEqual([]);
    expect((await listFiles('?prefix=%25')).items).toEqual([]);
  });

  it('rejects a cursor that is not one', async () => {
    const res = await alice.agent.get(`/api/v1/sources/${repoId}/files?cursor=`);
    expect(res.status).toBe(400);
  });
});

describe('GET /sources/:id/content?path=', () => {
  type Lines = {
    path: string;
    lineCount: number;
    lineStart: number;
    lineEnd: number;
    lines: { n: number; text: string }[];
  };
  const content = (query: string) => alice.agent.get(`/api/v1/sources/${repoId}/content?${query}`);

  it('returns numbered lines of a file', async () => {
    const res = await content('path=src/auth/service.ts&lineStart=4&lineEnd=5');
    expect(res.status).toBe(200);
    const body = dataOf<Lines>(res);
    const fileLines = FIXTURE_FILES['src/auth/service.ts']!.split('\n');
    expect(body).toMatchObject({ path: 'src/auth/service.ts', lineStart: 4, lineEnd: 5 });
    expect(body.lines).toEqual([
      { n: 4, text: fileLines[3] },
      { n: 5, text: fileLines[4] },
    ]);
  });

  it('defaults to the whole file and stops at 400 lines', async () => {
    const whole = dataOf<Lines>(await content('path=src/util.py'));
    expect(whole.lineStart).toBe(1);
    expect(whole.lineEnd).toBe(whole.lineCount);

    const long = dataOf<Lines>(await content('path=src/long.txt&lineStart=11'));
    expect(long).toMatchObject({ lineCount: 450, lineStart: 11, lineEnd: 410 });
    expect(long.lines).toHaveLength(400);
    expect(long.lines.at(-1)).toEqual({ n: 410, text: 'line 410' });

    const tail = dataOf<Lines>(await content('path=src/long.txt&lineStart=440&lineEnd=999'));
    expect(tail).toMatchObject({ lineStart: 440, lineEnd: 450 });
  });

  it('returns no lines for an empty file', async () => {
    const res = await content('path=src/empty.ts');
    expect(res.status).toBe(200);
    expect(dataOf<Lines>(res)).toMatchObject({ lineCount: 0, lineStart: 1, lineEnd: 0, lines: [] });
  });

  it('is a 404 for unknown and skipped files and lines past the end', async () => {
    expect((await content('path=src/nope.ts')).status).toBe(404);
    const skipped = await content('path=.env');
    expect(skipped.status).toBe(404);
    expect((skipped.body as { message: string }).message).toBe(
      "This file wasn't indexed (secret file)",
    );
    expect((await content('path=src/util.py&lineStart=999')).status).toBe(404);
  });

  it('rejects bad combinations', async () => {
    for (const query of [
      'path=src/util.py&lineStart=5&lineEnd=4',
      'path=src/util.py&page=1',
      'page=1&lineStart=2',
      'path=src/util.py&lineStart=0',
    ]) {
      expect((await content(query)).status, query).toBe(400);
    }
    // Lines only make sense for repository files.
    const pdf = await alice.agent.get(`/api/v1/sources/${sourceId}/content?path=fixture.pdf`);
    expect(pdf.status).toBe(400);
  });
});
