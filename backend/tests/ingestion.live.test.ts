import { afterAll, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import { downloadTarball, resolveCommit } from '../src/utils/github.js';
import { deletePrefix } from '../src/utils/storage.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { BOOK_PAGES, createPdfSource, createRepoSource, ingest } from './helpers/ingestion.js';
import { buildPdf } from './helpers/pdf.js';
import { buildTarball, FIXTURE_SECRETS, fixtureRepoEntries } from './helpers/repo.js';

// GitHub itself stays mocked: the fixture repository is served from memory.
vi.mock('../src/utils/github.js', () => ({
  resolveCommit: vi.fn(),
  downloadTarball: vi.fn(),
}));

// The fixtures through the real models: the PDF makes 4 contextualize calls (paced at the
// free-tier rate) and 4 embeddings, the repository 1-2 calls and under 10 embeddings.
// Run with: LIVE_TESTS=1 pnpm test tests/ingestion.live.test.ts
describe.skipIf(!serverConfig.LIVE_TESTS)('live ingestion', { timeout: 300_000 }, () => {
  let userId: string | undefined;

  afterAll(async () => {
    if (userId) await deletePrefix(`users/${userId}/`);
  });

  it('gives every child a context and a 1536-dimension vector', async () => {
    await resetDb();
    const alice = await signedInUser('alice@example.com');
    userId = alice.userId;
    const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Live' });
    const workspaceId = (res.body as { data: { id: string } }).data.id;
    const file = buildPdf({
      pages: BOOK_PAGES.slice(0, 4),
      outline: [
        { title: 'Topic 1', page: 2 },
        { title: 'Topic 2', page: 3 },
        { title: 'Topic 3', page: 4 },
      ],
    });
    const sourceId = await createPdfSource(alice.userId, workspaceId, file);

    const { result, error } = await ingest(sourceId);

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'done', chunks: 4, missingContexts: 0 });
    const children = await prismaClient.$queryRaw<{ context: string; dims: number }[]>`
      SELECT context, vector_dims(embedding) AS dims FROM "SourceChunk"
      WHERE "sourceId" = ${sourceId} AND kind = 'CHILD'
    `;
    expect(children).toHaveLength(4);
    for (const child of children) {
      expect(child.context.length).toBeGreaterThan(20);
      expect(child.dims).toBe(1536);
    }
  });

  it('contextualizes and embeds the fixture repository, secrets redacted', async () => {
    await resetDb();
    const alice = await signedInUser('alice@example.com');
    const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Live code' });
    const workspaceId = (res.body as { data: { id: string } }).data.id;
    vi.mocked(resolveCommit).mockResolvedValue({ sha: 'd'.repeat(40) });
    vi.mocked(downloadTarball).mockImplementation(
      async () => new Response(buildTarball(fixtureRepoEntries())).body!,
    );
    const sourceId = await createRepoSource(workspaceId);

    const { result, error } = await ingest(sourceId);

    expect(error).toBeUndefined();
    expect(result).toMatchObject({ outcome: 'done', missingContexts: 0 });
    const children = await prismaClient.$queryRaw<
      { context: string; content: string; dims: number }[]
    >`
      SELECT context, content, vector_dims(embedding) AS dims FROM "SourceChunk"
      WHERE "sourceId" = ${sourceId} AND kind = 'CHILD'
    `;
    expect(children.length).toBeGreaterThan(3);
    for (const child of children) {
      expect(child.context.length).toBeGreaterThan(20);
      expect(child.dims).toBe(1536);
      for (const secret of Object.values(FIXTURE_SECRETS)) {
        expect(child.content + child.context).not.toContain(secret);
      }
    }
  });
});
