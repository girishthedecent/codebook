import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { authAgent, ORIGIN, signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { seedSource } from './helpers/retrieval.js';

type User = Awaited<ReturnType<typeof signedInUser>>;
type HighlightBody = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  page: number | null;
  path: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  heading: string | null;
  text: string;
  note: string | null;
  createdAt: string;
};
type Page<T> = { items: T[]; nextCursor: string | null };

const MISSING_ID = 'cjld2cjxh0000qzrmn831i7rn';

let alice: User;
let bob: User;
let workspaceId: string;
let bookId: string;
let repoId: string;

beforeEach(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  bob = await signedInUser('bob@example.com');
  const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Notes' });
  workspaceId = (res.body as { data: { id: string } }).data.id;
  ({ sourceId: bookId } = await seedSource(workspaceId, { title: 'Data Book', chunks: {} }));
  ({ sourceId: repoId } = await seedSource(workspaceId, {
    type: 'GITHUB_REPO',
    title: 'acme/api',
    path: 'src/app.ts',
    chunks: {},
  }));
});

const highlightsPath = (id = workspaceId) => `/api/v1/workspaces/${id}/highlights`;

const onPage = (fields: object = {}) => ({
  sourceId: bookId,
  page: 42,
  heading: 'Replication',
  text: 'A leader sends every write to its followers.',
  ...fields,
});

async function highlight(body: object = onPage(), user = alice) {
  const res = await user.agent.post(highlightsPath()).send(body);
  expect(res.status, res.text).toBe(201);
  return (res.body as { data: HighlightBody }).data;
}

async function list(query: Record<string, string | number> = {}, user = alice) {
  const res = await user.agent.get(highlightsPath()).query(query);
  expect(res.status).toBe(200);
  return (res.body as { data: Page<HighlightBody> }).data;
}

describe('highlights API', () => {
  it('saves a highlight on a PDF page and one on lines of a file', async () => {
    const page = await highlight(onPage({ note: '  Check the failover chapter  ' }));
    expect(page).toEqual({
      id: expect.any(String),
      sourceId: bookId,
      sourceTitle: 'Data Book',
      sourceType: 'PDF',
      page: 42,
      path: null,
      lineStart: null,
      lineEnd: null,
      heading: 'Replication',
      text: 'A leader sends every write to its followers.',
      note: 'Check the failover chapter',
      createdAt: expect.any(String),
    });

    const code = await highlight({
      sourceId: repoId,
      path: 'src/app.ts',
      lineStart: 10,
      lineEnd: 12,
      text: 'app.use(helmet());',
    });
    expect(code).toMatchObject({
      sourceTitle: 'acme/api',
      sourceType: 'GITHUB_REPO',
      page: null,
      path: 'src/app.ts',
      lineStart: 10,
      lineEnd: 12,
      heading: null,
      note: null,
    });
  });

  it('wants exactly one of page and path, and text within its limits', async () => {
    const { maxTextChars, maxNoteChars } = appConfig.highlights;
    for (const body of [
      { sourceId: bookId, text: 'Nowhere.' },
      onPage({ path: 'book.pdf' }),
      onPage({ lineStart: 3 }),
      { sourceId: repoId, path: 'src/app.ts', lineStart: 5, lineEnd: 4, text: 'x' },
      onPage({ page: 0 }),
      onPage({ text: '   ' }),
      onPage({ text: 'x'.repeat(maxTextChars + 1) }),
      onPage({ note: 'x'.repeat(maxNoteChars + 1) }),
      onPage({ text: 'nul\0byte' }),
      onPage({ sourceId: 'not-an-id' }),
    ]) {
      const res = await alice.agent.post(highlightsPath()).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await prismaClient.highlight.count()).toBe(0);
  });

  it('refuses a source from another workspace', async () => {
    const other = await alice.agent.post('/api/v1/workspaces').send({ name: 'Other' });
    const otherId = (other.body as { data: { id: string } }).data.id;
    const { sourceId } = await seedSource(otherId, { title: 'Elsewhere', chunks: {} });

    const res = await alice.agent.post(highlightsPath()).send(onPage({ sourceId }));
    expect(res.status).toBe(404);
    expect(
      (await alice.agent.post(highlightsPath()).send(onPage({ sourceId: MISSING_ID }))).status,
    ).toBe(404);
  });

  it('lists newest first, a page at a time, and by source', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const body =
        i % 2 === 0
          ? onPage({ page: i + 1, text: `Passage ${i}` })
          : { sourceId: repoId, path: 'src/app.ts', text: `Line ${i}` };
      ids.push((await highlight(body)).id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: Record<string, string | number> = { limit: 2 };
      if (cursor) query.cursor = cursor;
      const page = await list(query);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());

    const ofRepo = await list({ sourceId: repoId });
    expect(ofRepo.items.map((item) => item.id)).toEqual([ids[3], ids[1]]);
  });

  it('edits and clears the note, and deletes', async () => {
    const { id } = await highlight();
    const patch = (body: object, user = alice) =>
      user.agent.patch(`/api/v1/highlights/${id}`).send(body);

    const noted = await patch({ note: 'Compare with Raft.' });
    expect(noted.status).toBe(200);
    expect((noted.body as { data: HighlightBody }).data).toMatchObject({
      id,
      note: 'Compare with Raft.',
      sourceTitle: 'Data Book',
    });

    expect(((await patch({ note: '' })).body as { data: HighlightBody }).data.note).toBeNull();
    await patch({ note: 'Again.' });
    expect(((await patch({ note: null })).body as { data: HighlightBody }).data.note).toBeNull();
    expect((await patch({})).status).toBe(400);
    expect((await patch({ note: 'x'.repeat(appConfig.highlights.maxNoteChars + 1) })).status).toBe(
      400,
    );

    expect((await alice.agent.delete(`/api/v1/highlights/${id}`)).status).toBe(204);
    expect((await alice.agent.delete(`/api/v1/highlights/${id}`)).status).toBe(404);
    expect((await patch({ note: 'Gone.' })).status).toBe(404);
  });

  it('keeps each user to their own', async () => {
    const { id } = await highlight();

    expect((await bob.agent.get(highlightsPath())).status).toBe(404);
    expect((await bob.agent.post(highlightsPath()).send(onPage())).status).toBe(404);
    expect((await bob.agent.patch(`/api/v1/highlights/${id}`).send({ note: 'x' })).status).toBe(
      404,
    );
    expect((await bob.agent.delete(`/api/v1/highlights/${id}`)).status).toBe(404);
    expect((await prismaClient.highlight.findUniqueOrThrow({ where: { id } })).note).toBeNull();
  });

  it('lets demo readers list (their own, so none) but not write, and guests get a 403', async () => {
    await highlight();
    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });

    expect((await list({}, bob)).items).toEqual([]);
    expect((await bob.agent.post(highlightsPath()).send(onPage())).status).toBe(404);

    const guest = authAgent();
    await guest.post('/api/auth/sign-in/anonymous').set('origin', ORIGIN).send({});
    expect((await guest.get(highlightsPath())).status).toBe(200);
    expect((await guest.post(highlightsPath()).send(onPage())).status).toBe(403);
    expect((await guest.patch(`/api/v1/highlights/${MISSING_ID}`).send({ note: 'x' })).status).toBe(
      403,
    );
    expect((await guest.delete(`/api/v1/highlights/${MISSING_ID}`)).status).toBe(403);
  });

  it('stops at the limit per user and workspace with HIGHLIGHT_LIMIT', async () => {
    const { maxPerWorkspace } = appConfig.highlights;
    await prismaClient.highlight.createMany({
      data: Array.from({ length: maxPerWorkspace - 1 }, (_, i) => ({
        workspaceId,
        userId: alice.userId,
        sourceId: bookId,
        page: i + 1,
        text: `Passage ${i}`,
      })),
    });

    // Two at once for the last place: one gets it.
    const statuses = await Promise.all(
      [1, 2].map(async () => (await alice.agent.post(highlightsPath()).send(onPage())).status),
    );
    expect(statuses.sort()).toEqual([201, 409]);

    const refused = await alice.agent.post(highlightsPath()).send(onPage());
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'HIGHLIGHT_LIMIT' });
    expect(await prismaClient.highlight.count()).toBe(maxPerWorkspace);
  });

  it('goes with its source', async () => {
    await highlight();
    await prismaClient.source.delete({ where: { id: bookId } });
    expect(await prismaClient.highlight.count()).toBe(0);
  });

  it('enforces one of page and path in the database too', async () => {
    await expect(
      prismaClient.highlight.create({
        data: { workspaceId, userId: alice.userId, sourceId: bookId, text: 'x' },
      }),
    ).rejects.toThrow();
  });
});
