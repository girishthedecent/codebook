import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { textRoutes } from '../src/llm/models.js';
import { contextualRetrievalFor } from '../src/modules/ingestion/contextUnits.js';
import { defaultWebsiteTitle } from '../src/modules/sources/source.service.js';
import { downloadTarball, resolveCommit } from '../src/utils/github.js';
import { allowTestAddresses } from '../src/utils/network.js';
import { deletePrefix } from '../src/utils/storage.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import {
  codeContextReply,
  contextReply,
  createPdfSource,
  createRepoSource,
  ingest,
} from './helpers/ingestion.js';
import { promptModel, useModels } from './helpers/llm-mock.js';
import { buildTarball, fixtureRepoEntries } from './helpers/repo.js';
import { site } from './helpers/site.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));
vi.mock('../src/utils/github.js', () => ({
  resolveCommit: vi.fn(),
  downloadTarball: vi.fn(),
}));

type User = Awaited<ReturnType<typeof signedInUser>>;
let alice: User;
let contextCalls: number;
const usedUsers: string[] = [];

beforeEach(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
  usedUsers.push(alice.userId);
  contextCalls = 0;
  useModels({
    [textRoutes.contextualize.primary.model]: promptModel((prompt) => {
      contextCalls++;
      // Code packs name their files; documents name their section.
      return prompt.includes('<file path=') ? codeContextReply(prompt) : contextReply(prompt);
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const userId of new Set(usedUsers)) await deletePrefix(`users/${userId}/`);
});

async function workspace(name: string, settings: object = {}) {
  const row = await prismaClient.workspace.create({
    data: { userId: alice.userId, name, settings },
  });
  return row.id;
}

const childrenOf = (sourceId: string) =>
  prismaClient.sourceChunk.findMany({ where: { sourceId, kind: 'CHILD' } });

describe('contextualRetrievalFor', () => {
  it('follows the workspace setting and falls back to the app default', () => {
    expect(contextualRetrievalFor({ contextualRetrieval: false })).toBe(false);
    expect(contextualRetrievalFor({ contextualRetrieval: true })).toBe(true);
    expect(contextualRetrievalFor({})).toBe(true);
    expect(contextualRetrievalFor({ contextualRetrieval: 'no' })).toBe(true);
    expect(contextualRetrievalFor(null)).toBe(true);
  });
});

describe('a workspace with contextual retrieval off', () => {
  it('ingests without contextualize calls or contexts, under another content hash', async () => {
    const on = await createPdfSource(alice.userId, await workspace('On'));
    await ingest(on);
    expect(contextCalls).toBeGreaterThan(0);

    contextCalls = 0;
    const offWorkspace = await workspace('Off', { contextualRetrieval: false });
    const off = await createPdfSource(alice.userId, offWorkspace);
    const { result } = await ingest(off);

    expect(result).toMatchObject({ outcome: 'done' });
    expect(contextCalls).toBe(0);
    const children = await childrenOf(off);
    expect(children.length).toBeGreaterThan(0);
    // The contexts written for the other workspace's copy are in the cache, but not used.
    expect(children.every((child) => child.context === null)).toBe(true);
    expect(children.every((child) => !child.searchText.includes('Context '))).toBe(true);

    const onRow = await prismaClient.source.findUniqueOrThrow({ where: { id: on } });
    const offRow = await prismaClient.source.findUniqueOrThrow({ where: { id: off } });
    expect(offRow.contentHash).not.toBe(onRow.contentHash);
    expect(offRow.stats).toMatchObject({ missingContexts: 0 });
  });

  it('re-indexes with contexts once the setting is turned back on', async () => {
    const workspaceId = await workspace('Off', { contextualRetrieval: false });
    const sourceId = await createPdfSource(alice.userId, workspaceId);
    await ingest(sourceId);
    expect(contextCalls).toBe(0);

    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { settings: {} } });
    const { result } = await ingest(sourceId);

    expect(result).not.toMatchObject({ outcome: 'skipped' });
    expect(contextCalls).toBeGreaterThan(0);
    expect((await childrenOf(sourceId)).every((child) => child.context !== null)).toBe(true);
  });

  it('keeps the setting when the user changes other settings', async () => {
    const workspaceId = await workspace('Off', { contextualRetrieval: false });
    const res = await alice.agent
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .send({ settings: { studyToolsEnabled: false } });
    expect(res.status).toBe(200);

    const row = await prismaClient.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    expect(row.settings).toEqual({ contextualRetrieval: false, studyToolsEnabled: false });
  });

  it('cannot be set through the API', async () => {
    const workspaceId = await workspace('On');
    const res = await alice.agent
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .send({ settings: { contextualRetrieval: false } });
    expect(res.status).toBe(400);
  });
});

describe('repositories and websites', () => {
  let base: string;

  beforeAll(async () => {
    allowTestAddresses(['127.0.0.1']);
    base = await site.start();
  });

  afterAll(async () => {
    allowTestAddresses([]);
    await site.stop();
  });

  beforeEach(() => {
    site.reset();
    vi.mocked(resolveCommit).mockResolvedValue({ sha: 'a'.repeat(40) });
    vi.mocked(downloadTarball).mockImplementation(
      async () => new Response(buildTarball(fixtureRepoEntries())).body!,
    );
  });

  async function createWebsiteSource(workspaceId: string) {
    const url = new URL('/guide', base);
    const source = await prismaClient.source.create({
      data: {
        workspaceId,
        type: 'WEBSITE',
        title: defaultWebsiteTitle(url),
        origin: { url: url.href, maxDepth: 0, maxPages: 1 },
        dedupeKey: `web:${url.href}`,
      },
    });
    return source.id;
  }

  const create = { repository: createRepoSource, website: createWebsiteSource };

  it.each(['repository', 'website'] as const)(
    'a %s is re-indexed without contexts once the setting is turned off',
    async (kind) => {
      const workspaceId = await workspace('Switch');
      const sourceId = await create[kind](workspaceId);
      await ingest(sourceId);
      expect(contextCalls).toBeGreaterThan(0);
      const before = await prismaClient.source.findUniqueOrThrow({ where: { id: sourceId } });

      await prismaClient.workspace.update({
        where: { id: workspaceId },
        data: { settings: { contextualRetrieval: false } },
      });
      contextCalls = 0;
      const { result } = await ingest(sourceId);

      // Same content, so only the setting can have changed the hash and forced the re-index.
      expect(result).toMatchObject({ outcome: 'done' });
      expect(contextCalls).toBe(0);
      const children = await childrenOf(sourceId);
      expect(children.length).toBeGreaterThan(0);
      expect(children.every((child) => child.context === null)).toBe(true);
      const after = await prismaClient.source.findUniqueOrThrow({ where: { id: sourceId } });
      expect(after.contentHash).not.toBe(before.contentHash);
    },
  );
});
