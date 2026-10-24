import { lookup } from 'node:dns/promises';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { inngest } from '../src/config/inngest.config.js';
import { s3Client } from '../src/config/storage.config.js';
import { getRepo, refExists } from '../src/utils/github.js';
import { createSource } from '../src/modules/sources/source.repository.js';
import { isValidGitRef, parseGithubUrl } from '../src/modules/sources/githubUrl.js';
import { isCleanupPrefix, pdfStorageKey } from '../src/modules/sources/source.storage.js';
import { drainRegistry } from '../src/utils/helpers/shutdown.helpers.js';
import { deletePrefix, headObject } from '../src/utils/storage.js';
import { authAgent, ORIGIN, signedInUser } from './helpers/auth.js';
import { countLockWaiters, resetDb } from './helpers/db.js';
import { minimalPdf } from './helpers/pdf.js';

vi.mock('../src/utils/github.js', () => ({
  getRepo: vi.fn(),
  refExists: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

type User = Awaited<ReturnType<typeof signedInUser>>;
type SourceBody = {
  id: string;
  status: string;
  title: string;
  origin: Record<string, unknown>;
  error: string | null;
};

const MISSING_ID = 'cjld2cjxh0000qzrmn831i7rn';
const REPO = {
  fullName: 'acme/widgets',
  isPrivate: false,
  sizeKb: 1_000,
  defaultBranch: 'main',
};

let alice: User;
let bob: User;
let workspaceId: string;
let send: ReturnType<typeof spyOnSend>;
const spyOnSend = () => vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] } as never);
const usedUsers: string[] = [];

beforeEach(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  bob = await signedInUser('bob@example.com');
  usedUsers.push(alice.userId, bob.userId);
  workspaceId = await createWorkspace(alice);

  send = spyOnSend();
  vi.mocked(getRepo).mockResolvedValue(REPO);
  vi.mocked(refExists).mockResolvedValue(true);
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.215.14', family: 4 }] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // Everything uploaded lives under these users' prefixes in the test bucket.
  for (const userId of new Set(usedUsers)) await deletePrefix(`users/${userId}/`);
});

async function createWorkspace(user: User) {
  const res = await user.agent.post('/api/v1/workspaces').send({ name: 'Notes' });
  return (res.body as { data: { id: string } }).data.id;
}

const sourcesPath = (id = workspaceId) => `/api/v1/workspaces/${id}/sources`;

function uploadPdf(
  user: User,
  file = minimalPdf(),
  { filename = 'Designing Data.pdf', contentType = 'application/pdf', id = workspaceId } = {},
) {
  return user.agent.post(sourcesPath(id)).attach('file', file, { filename, contentType });
}

function addRepo(user: User, body: object = {}) {
  return user.agent
    .post(sourcesPath())
    .send({ type: 'GITHUB_REPO', url: 'https://github.com/acme/widgets', ...body });
}

function addWebsite(user: User, body: object = {}) {
  return user.agent
    .post(sourcesPath())
    .send({ type: 'WEBSITE', url: 'https://docs.example.com/guide#intro', ...body });
}

const bodyOf = (res: { body: unknown }) => (res.body as { data: SourceBody }).data;

// Multer writes uploads to os.tmpdir() under random 32-hex-character names.
async function uploadTempFiles() {
  return (await readdir(tmpdir())).filter((name) => /^[0-9a-f]{32}$/.test(name));
}

describe('PDF upload', () => {
  it('stores the file, creates the source and queues ingestion', async () => {
    const res = await uploadPdf(alice);
    expect(res.status).toBe(201);

    const source = bodyOf(res);
    expect(source).toMatchObject({
      status: 'PENDING',
      title: 'Designing Data',
      origin: {
        fileName: 'Designing Data.pdf',
        size: minimalPdf().length,
        mime: 'application/pdf',
      },
    });
    expect(source.origin).not.toHaveProperty('storageKey');

    const stored = await headObject(pdfStorageKey(alice.userId, workspaceId, source.id));
    expect(stored).toEqual({ size: minimalPdf().length, contentType: 'application/pdf' });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({
      name: 'source/ingest.requested',
      data: { sourceId: source.id, reason: 'created' },
    });
  });

  it('takes an optional title', async () => {
    const res = await alice.agent
      .post(sourcesPath())
      .field('title', 'DDIA')
      .attach('file', minimalPdf(), { filename: 'book.pdf', contentType: 'application/pdf' });
    expect(bodyOf(res).title).toBe('DDIA');
  });

  it('rejects a file that only pretends to be a PDF', async () => {
    const res = await uploadPdf(alice, Buffer.from('<html>not a pdf</html>'));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: 'The file is not a valid PDF' });
    expect(await prismaClient.source.count()).toBe(0);
  });

  it('rejects other file types by name or type', async () => {
    expect((await uploadPdf(alice, minimalPdf(), { filename: 'notes.txt' })).status).toBe(400);
    expect((await uploadPdf(alice, minimalPdf(), { contentType: 'text/plain' })).status).toBe(400);
  });

  it('answers a malformed multipart body with 400, not 500', async () => {
    const res = await alice.agent
      .post(sourcesPath())
      .set('Content-Type', 'multipart/form-data; boundary=nope')
      .send('--nope\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n');
    expect(res.status).toBe(400);
  });

  it('requires the file field', async () => {
    const res = await alice.agent.post(sourcesPath()).field('title', 'no file');
    expect(res.status).toBe(400);
  });

  it('rejects files over the size limit with 413 and leaves no temp files', async () => {
    const before = await uploadTempFiles();
    const big = Buffer.concat([minimalPdf(), Buffer.alloc(appConfig.sources.maxPdfBytes)]);

    const res = await uploadPdf(alice, big);
    expect(res.status).toBe(413);
    expect(await uploadTempFiles()).toEqual(before);
  });

  it('leaves no temp files after a successful or rejected upload', async () => {
    const before = await uploadTempFiles();
    await uploadPdf(alice);
    await uploadPdf(alice, Buffer.from('fake'));
    // The cleanup runs when the response closes, just after the client has it.
    await expect.poll(uploadTempFiles).toEqual(before);
  });

  it('treats the same bytes as a duplicate, whatever the file name', async () => {
    expect((await uploadPdf(alice)).status).toBe(201);
    const res = await uploadPdf(alice, minimalPdf(), { filename: 'copy.pdf' });
    expect(res.status).toBe(409);
  });

  it('drops the source when storage fails', async () => {
    vi.spyOn(s3Client, 'send').mockRejectedValueOnce(new Error('storage down') as never);
    const res = await uploadPdf(alice);
    expect(res.status).toBe(502);
    expect(await prismaClient.source.count()).toBe(0);
  });

  it('removes the file when the source is deleted during the upload', async () => {
    const realSend = s3Client.send.bind(s3Client);
    const s3 = vi.spyOn(s3Client, 'send').mockImplementationOnce((async () => {
      // The user deletes the source while its file is still uploading.
      await prismaClient.source.deleteMany();
      return {};
    }) as never);
    s3.mockImplementation(realSend as never);

    const res = await uploadPdf(alice);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: /deleted while it was uploading/ });
    expect(s3.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'PutObjectCommand',
      'DeleteObjectCommand',
    ]);
  });

  it("refuses uploads to someone else's workspace before reading them", async () => {
    const res = await uploadPdf(bob);
    expect(res.status).toBe(404);
    expect(await prismaClient.source.count()).toBe(0);
  });
});

describe('GitHub repo', () => {
  it('adds a public repo on its default branch', async () => {
    const res = await addRepo(alice);
    expect(res.status).toBe(201);
    expect(bodyOf(res)).toMatchObject({
      status: 'PENDING',
      title: 'acme/widgets',
      origin: { owner: 'acme', repo: 'widgets', ref: 'main', defaultBranch: 'main' },
    });
    expect(refExists).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  it('takes the ref from a /tree/ URL and checks it exists', async () => {
    const res = await addRepo(alice, { url: 'https://github.com/acme/widgets/tree/release/v2' });
    expect(bodyOf(res)).toMatchObject({
      title: 'acme/widgets@release/v2',
      origin: { ref: 'release/v2' },
    });
    expect(refExists).toHaveBeenCalledWith('acme', 'widgets', 'release/v2');
  });

  it('rejects missing, private, oversized repos and unknown refs', async () => {
    vi.mocked(getRepo).mockResolvedValueOnce(null);
    expect((await addRepo(alice)).body).toMatchObject({ message: /not found/ });

    vi.mocked(getRepo).mockResolvedValueOnce({ ...REPO, isPrivate: true });
    expect((await addRepo(alice)).body).toMatchObject({ message: /public/ });

    vi.mocked(getRepo).mockResolvedValueOnce({ ...REPO, sizeKb: 300 * 1024 });
    expect((await addRepo(alice)).body).toMatchObject({ message: /larger than 200 MB/ });

    vi.mocked(refExists).mockResolvedValueOnce(false);
    const res = await addRepo(alice, { ref: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: /"nope" not found/ });

    expect(await prismaClient.source.count()).toBe(0);
  });

  it('rejects ref names git itself would refuse', async () => {
    for (const ref of [
      '.',
      '..',
      '@',
      'a..b',
      'feat/',
      '/feat',
      'a b',
      'x.lock',
      'a.lock/b',
      'a~1',
    ]) {
      const res = await addRepo(alice, { ref });
      expect(res.status, ref).toBe(400);
    }
    // Refused before spending any GitHub request.
    expect(getRepo).not.toHaveBeenCalled();
    expect(refExists).not.toHaveBeenCalled();
  });

  it('rejects URLs that are not GitHub repos', async () => {
    for (const url of ['https://gitlab.com/acme/widgets', 'https://github.com/acme']) {
      expect((await addRepo(alice, { url })).status).toBe(400);
    }
  });

  it('treats the same repo and ref as a duplicate, ignoring name case', async () => {
    expect((await addRepo(alice)).status).toBe(201);
    expect((await addRepo(alice, { url: 'https://github.com/ACME/Widgets' })).status).toBe(409);
    // Another ref of the same repo is a different source.
    expect((await addRepo(alice, { ref: 'v1.0.0' })).status).toBe(201);
  });
});

describe('website', () => {
  it('adds a public site with default crawl limits, without the fragment', async () => {
    const res = await addWebsite(alice);
    expect(res.status).toBe(201);
    expect(bodyOf(res)).toMatchObject({
      title: 'docs.example.com/guide',
      origin: { url: 'https://docs.example.com/guide', maxDepth: 0, maxPages: 10 },
    });
  });

  it('rejects sites on private addresses', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '10.0.0.7', family: 4 }] as never);
    const res = await addWebsite(alice);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: /private/ });
  });

  it('validates the crawl limits', async () => {
    expect((await addWebsite(alice, { maxDepth: 3 })).status).toBe(400);
    expect((await addWebsite(alice, { maxPages: 0 })).status).toBe(400);
    expect((await addWebsite(alice, { url: 'ftp://example.com' })).status).toBe(400);
  });

  it('treats the same URL as a duplicate', async () => {
    expect((await addWebsite(alice)).status).toBe(201);
    expect((await addWebsite(alice, { url: 'https://docs.example.com/guide' })).status).toBe(409);
  });
});

describe('limits and races', () => {
  async function seedSources(count: number) {
    await prismaClient.source.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        workspaceId,
        type: 'WEBSITE' as const,
        title: `site ${i}`,
        origin: {},
        dedupeKey: `seed:${i}`,
      })),
    });
  }

  it('stops at the per-workspace limit', async () => {
    await seedSources(appConfig.sources.maxPerWorkspace);
    const res = await addWebsite(alice);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: /up to 25 sources/ });
  });

  it('keeps the limit when creates race each other', async () => {
    await seedSources(appConfig.sources.maxPerWorkspace - 1);

    // Same technique as the workspace limit test: inserts are blocked until all four
    // requests are waiting, so without the workspace row lock all four would pass the count.
    const requests = await prismaClient.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "Source" IN SHARE MODE`;
        const pending = Array.from({ length: 4 }, async (_, i) =>
          addWebsite(alice, { url: `https://docs.example.com/page-${i}` }),
        );
        await expect.poll(() => countLockWaiters(), { timeout: 10_000 }).toBe(4);
        return pending;
      },
      { timeout: 15_000 },
    );

    const results = await Promise.all(requests);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
  });

  it('lets only one of two identical concurrent creates through', async () => {
    const results = await Promise.all([addRepo(alice), addRepo(alice)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe('queue unavailable', () => {
  it('marks the source FAILED instead of leaving it pending', async () => {
    send.mockRejectedValueOnce(new Error('queue down'));
    const res = await addRepo(alice);
    expect(res.status).toBe(201);
    expect(bodyOf(res)).toMatchObject({ status: 'FAILED', error: /resync/ });
  });
});

describe('reading', () => {
  it('lists the workspace sources, newest first', async () => {
    await addRepo(alice);
    await addWebsite(alice);
    const res = await alice.agent.get(sourcesPath());
    expect(res.status).toBe(200);
    const items = (res.body as { data: { items: SourceBody[] } }).data.items;
    expect(items.map((s) => s.title)).toEqual(['docs.example.com/guide', 'acme/widgets']);
  });

  it('gets one source', async () => {
    const { id } = bodyOf(await addRepo(alice));
    const res = await alice.agent.get(`/api/v1/sources/${id}`);
    expect(bodyOf(res)).toMatchObject({ id, title: 'acme/widgets' });
  });

  it("hides another user's sources", async () => {
    const { id } = bodyOf(await addRepo(alice));
    expect((await bob.agent.get(`/api/v1/sources/${id}`)).status).toBe(404);
    expect((await bob.agent.get(sourcesPath())).status).toBe(404);
    expect((await bob.agent.delete(`/api/v1/sources/${id}`)).status).toBe(404);
    expect((await bob.agent.post(`/api/v1/sources/${id}/resync`)).status).toBe(404);
    expect((await bob.agent.get(`/api/v1/sources/${id}/events`)).status).toBe(404);
  });

  it('lets anyone read the demo workspace but not change it', async () => {
    const { id } = bodyOf(await addRepo(alice));
    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });

    expect((await bob.agent.get(sourcesPath())).status).toBe(200);
    expect((await bob.agent.get(`/api/v1/sources/${id}`)).status).toBe(200);
    expect((await addRepo(bob, { ref: 'dev' })).status).toBe(404);
    expect((await uploadPdf(bob)).status).toBe(404);
    expect((await bob.agent.delete(`/api/v1/sources/${id}`)).status).toBe(404);
    expect((await bob.agent.post(`/api/v1/sources/${id}/resync`)).status).toBe(404);
  });

  it('adds source counts by status to the workspace', async () => {
    await addRepo(alice);
    send.mockRejectedValueOnce(new Error('queue down'));
    await addWebsite(alice);

    const res = await alice.agent.get(`/api/v1/workspaces/${workspaceId}`);
    expect((res.body as { data: { counts: unknown } }).data.counts).toEqual({
      sources: { PENDING: 1, PROCESSING: 0, READY: 0, FAILED: 1 },
      conversations: 0,
    });
  });

  it('returns 404 for a missing source and 400 for a bad id', async () => {
    expect((await alice.agent.get(`/api/v1/sources/${MISSING_ID}`)).status).toBe(404);
    expect((await alice.agent.get('/api/v1/sources/not-an-id')).status).toBe(400);
  });
});

describe('delete', () => {
  it('removes the source and queues the file cleanup', async () => {
    const { id } = bodyOf(await uploadPdf(alice));
    send.mockClear();

    expect((await alice.agent.delete(`/api/v1/sources/${id}`)).status).toBe(204);
    expect(await prismaClient.source.count()).toBe(0);
    expect(send.mock.calls[0]![0]).toMatchObject({
      name: 'source/deleted',
      data: {
        sourceId: id,
        storagePrefix: `users/${alice.userId}/workspaces/${workspaceId}/sources/${id}/`,
      },
    });
  });

  it('deletes the files inline when the queue is down', async () => {
    const { id } = bodyOf(await uploadPdf(alice));
    const key = pdfStorageKey(alice.userId, workspaceId, id);
    send.mockRejectedValueOnce(new Error('queue down'));

    expect((await alice.agent.delete(`/api/v1/sources/${id}`)).status).toBe(204);
    expect(await headObject(key)).toBeNull();
  });
});

describe('resync', () => {
  it('queues a finished source again', async () => {
    const { id } = bodyOf(await addRepo(alice));
    await prismaClient.source.update({ where: { id }, data: { status: 'READY', progress: 100 } });
    send.mockClear();

    const res = await alice.agent.post(`/api/v1/sources/${id}/resync`);
    expect(res.status).toBe(202);
    expect(bodyOf(res)).toMatchObject({ status: 'PENDING' });
    expect(send.mock.calls[0]![0]).toMatchObject({ data: { sourceId: id, reason: 'resync' } });
  });

  it('recovers a source stuck in PENDING (its event was never sent)', async () => {
    const { id } = bodyOf(await addRepo(alice));
    const stale = new Date(Date.now() - appConfig.sources.stalePendingMs - 1_000);
    await prismaClient.$executeRaw`UPDATE "Source" SET "updatedAt" = ${stale} WHERE id = ${id}`;

    const res = await alice.agent.post(`/api/v1/sources/${id}/resync`);
    expect(res.status).toBe(202);
  });

  it('recovers a source stuck in PROCESSING (its run died without failing)', async () => {
    const { id } = bodyOf(await addRepo(alice));
    await prismaClient.source.update({ where: { id }, data: { status: 'PROCESSING' } });
    // Still being worked on: every ingest step updates the row.
    const recent = new Date(Date.now() - appConfig.sources.stalePendingMs - 1_000);
    await prismaClient.$executeRaw`UPDATE "Source" SET "updatedAt" = ${recent} WHERE id = ${id}`;
    expect((await alice.agent.post(`/api/v1/sources/${id}/resync`)).status).toBe(409);

    const stale = new Date(Date.now() - appConfig.sources.staleProcessingMs - 1_000);
    await prismaClient.$executeRaw`UPDATE "Source" SET "updatedAt" = ${stale} WHERE id = ${id}`;
    expect((await alice.agent.post(`/api/v1/sources/${id}/resync`)).status).toBe(202);
  });

  it('tells the user to re-upload a PDF whose upload never finished', async () => {
    const { id } = bodyOf(await uploadPdf(alice));
    await prismaClient.$executeRaw`
      UPDATE "Source" SET origin = jsonb_set(origin, '{storageKey}', 'null') WHERE id = ${id}
    `;

    const res = await alice.agent.post(`/api/v1/sources/${id}/resync`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: /upload it again/ });
    expect(await prismaClient.source.findUnique({ where: { id } })).toMatchObject({
      status: 'FAILED',
    });
  });

  it('refuses while the source is queued or processing', async () => {
    const { id } = bodyOf(await addRepo(alice));
    expect((await alice.agent.post(`/api/v1/sources/${id}/resync`)).status).toBe(409);
    await prismaClient.source.update({ where: { id }, data: { status: 'PROCESSING' } });
    expect((await alice.agent.post(`/api/v1/sources/${id}/resync`)).status).toBe(409);
  });
});

describe('progress stream', () => {
  // Collects the whole stream; the server ends it after `done` or `failed`.
  function readStream(user: User, id: string) {
    return user.agent
      .get(`/api/v1/sources/${id}/events`)
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => done(null, body));
      });
  }

  it('sends the current state, then done, and closes', async () => {
    const { id } = bodyOf(await addRepo(alice));
    await prismaClient.source.update({
      where: { id },
      data: { status: 'READY', stage: 'DONE', progress: 100 },
    });

    const res = await readStream(alice, id);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.body).toContain('event: progress\ndata: {"status":"READY"');
    expect(res.body).toContain('event: done');
  });

  it('follows changes until the source finishes', async () => {
    const { id } = bodyOf(await addRepo(alice));
    // supertest only sends the request once it's awaited or then'd.
    const pending = readStream(alice, id).then((res) => res);

    await new Promise((resolve) => setTimeout(resolve, 300));
    await prismaClient.source.update({
      where: { id },
      data: { status: 'PROCESSING', stage: 'FETCHING', progress: 10 },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await prismaClient.source.update({
      where: { id },
      data: { status: 'FAILED', error: 'Could not fetch' },
    });

    const body = (await pending).body as string;
    const events = [...body.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    expect(events).toEqual(['progress', 'progress', 'progress', 'failed']);
    expect(body).toContain('"error":"Could not fetch"');
  });
});

describe('shutdown', () => {
  it('ends open progress streams when the server starts shutting down', async () => {
    const { id } = bodyOf(await addRepo(alice));
    await prismaClient.source.update({ where: { id }, data: { status: 'PROCESSING' } });

    const pending = alice.agent
      .get(`/api/v1/sources/${id}/events`)
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => done(null, body));
      })
      .then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 300));

    await drainRegistry.run();
    const res = await pending;
    expect(res.body).toContain('"status":"PROCESSING"');
    expect(res.body).not.toContain('event: done');
  });
});

describe('origin check', () => {
  it('rejects browser writes from untrusted origins', async () => {
    const res = await addRepo(alice).set('origin', 'https://evil.test');
    expect(res.status).toBe(403);
    expect(await prismaClient.source.count()).toBe(0);
  });

  it('allows the app and trusted origins', async () => {
    expect((await addRepo(alice).set('origin', ORIGIN)).status).toBe(201);
    expect((await addWebsite(alice).set('origin', 'http://localhost:3000')).status).toBe(201);
  });
});

describe('auth', () => {
  it('requires a session on every route', async () => {
    const agent = authAgent();
    const routes = [
      agent.get(sourcesPath()),
      agent.post(sourcesPath()).send({}),
      agent.get(`/api/v1/sources/${MISSING_ID}`),
      agent.delete(`/api/v1/sources/${MISSING_ID}`),
      agent.post(`/api/v1/sources/${MISSING_ID}/resync`),
      agent.get(`/api/v1/sources/${MISSING_ID}/events`),
    ];
    for (const res of await Promise.all(routes)) expect(res.status).toBe(401);
  });
});

describe('helpers', () => {
  it('parses GitHub URLs', () => {
    expect(parseGithubUrl('https://github.com/acme/widgets')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      ref: undefined,
    });
    expect(parseGithubUrl('https://github.com/acme/widgets.git')).toMatchObject({
      repo: 'widgets',
    });
    expect(parseGithubUrl('https://www.github.com/acme/widgets/tree/feat/x/')).toMatchObject({
      ref: 'feat/x',
    });
    expect(() => parseGithubUrl('https://github.com/acme/widgets/blob/main/a.ts')).toThrow();
    // Branch names in URLs are percent-encoded.
    expect(parseGithubUrl('https://github.com/acme/widgets/tree/funci%C3%B3n')).toMatchObject({
      ref: 'función',
    });
    expect(() => parseGithubUrl('https://github.com/acme/widgets/tree/%E0%A4%A')).toThrow();
  });

  it('accepts ordinary ref names', () => {
    for (const ref of ['main', 'release/v2', 'v1.0.0', 'feature/new-ui', 'a1b2c3d']) {
      expect(isValidGitRef(ref), ref).toBe(true);
    }
  });

  it('reports a workspace deleted after the access check as missing', async () => {
    const result = await createSource(
      MISSING_ID,
      { type: 'WEBSITE', title: 't', origin: {}, dedupeKey: 'k' },
      25,
    );
    expect(result).toEqual({ ok: false, reason: 'no-workspace' });
  });

  it('only lets cleanup delete a workspace or source folder', () => {
    expect(isCleanupPrefix('users/u1/workspaces/w1/')).toBe(true);
    expect(isCleanupPrefix('users/u1/workspaces/w1/sources/s1/')).toBe(true);
    for (const prefix of [
      '',
      'users/',
      'users/u1/',
      'users/u1/workspaces/',
      'users/u1/workspaces/w1',
    ]) {
      expect(isCleanupPrefix(prefix), prefix).toBe(false);
    }
  });
});
