import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { textRoutes } from '../src/llm/models.js';
import { downloadTarball, resolveCommit } from '../src/utils/github.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { codeContextReply, createRepoSource, ingest } from './helpers/ingestion.js';
import { fakeEmbeddingModel, promptModel, useModels } from './helpers/llm-mock.js';
import {
  buildTarball,
  FIXTURE_FILES,
  FIXTURE_SECRETS,
  fixtureRepoEntries,
  type TarEntry,
} from './helpers/repo.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));
vi.mock('../src/utils/github.js', () => ({
  resolveCommit: vi.fn(),
  downloadTarball: vi.fn(),
}));

const SHA = 'a'.repeat(40);

let workspaceId: string;
let prompts: string[];
let doEmbed: MockInstance<typeof fakeEmbeddingModel.doEmbed>;

function serveRepo(entries: TarEntry[] = fixtureRepoEntries(), sha = SHA) {
  vi.mocked(resolveCommit).mockResolvedValue({ sha });
  vi.mocked(downloadTarball).mockImplementation(
    async () => new Response(buildTarball(entries)).body!,
  );
}

beforeEach(async () => {
  await resetDb();
  const alice = await signedInUser('alice@example.com');
  const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'Code' });
  workspaceId = (res.body as { data: { id: string } }).data.id;
  prompts = [];
  useModels({
    [textRoutes.contextualize.primary.model]: promptModel((prompt) => {
      prompts.push(prompt);
      return codeContextReply(prompt);
    }),
  });
  doEmbed = vi.spyOn(fakeEmbeddingModel, 'doEmbed');
  vi.mocked(downloadTarball).mockReset();
  serveRepo();
});

afterEach(() => {
  doEmbed.mockRestore();
});

const sourceRow = (id: string) => prismaClient.source.findUniqueOrThrow({ where: { id } });
const documentsOf = (sourceId: string) =>
  prismaClient.sourceDocument.findMany({ where: { sourceId }, orderBy: { path: 'asc' } });

describe('ingesting a GitHub repository', () => {
  it('indexes the kept files and lists the skipped ones with their reasons', async () => {
    const sourceId = await createRepoSource(workspaceId);
    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'done' });
    const source = await sourceRow(sourceId);
    expect(source).toMatchObject({ status: 'READY', stage: 'DONE', progress: 100, error: null });
    expect(source.stats).toMatchObject({
      commitSha: SHA,
      files: 4,
      skippedFiles: 6,
      redactions: 2,
      languages: { markdown: 1, typescript: 1, python: 1, json: 1 },
      missingContexts: 0,
    });
    expect(source.stats).not.toHaveProperty('pages');

    const documents = await documentsOf(sourceId);
    const skipped = Object.fromEntries(
      documents.filter((doc) => doc.skippedReason).map((doc) => [doc.path, doc.skippedReason]),
    );
    expect(skipped).toEqual({
      '.env': 'secret file',
      'CHANGELOG.md': 'changelog',
      'assets/logo.png': 'binary',
      'docs/link.md': 'link',
      'node_modules/': 'dependencies',
      'test/': 'test',
    });
    for (const doc of documents.filter((row) => row.skippedReason)) {
      expect(doc.content).toBe('');
    }
    expect(documents.find((doc) => doc.path === 'node_modules/')!.sizeBytes).toBeGreaterThan(40);

    const service = documents.find((doc) => doc.path === 'src/auth/service.ts')!;
    expect(service).toMatchObject({
      language: 'typescript',
      lineCount: FIXTURE_FILES['src/auth/service.ts']!.split('\n').length - 1,
    });
    expect(await prismaClient.tocNode.count({ where: { sourceId } })).toBe(0);
    expect(await prismaClient.ingestDraft.count()).toBe(0);
  });

  it('chunks code by symbol, with exact line ranges, contexts and vectors', async () => {
    const sourceId = await createRepoSource(workspaceId);
    await ingest(sourceId);

    const documents = await documentsOf(sourceId);
    const children = await prismaClient.sourceChunk.findMany({
      where: { sourceId, kind: 'CHILD' },
      include: { document: { select: { path: true, content: true } } },
    });
    for (const child of children) {
      // The chunk's first and last lines sit exactly on lineStart and lineEnd.
      const lines = child.document.content.split('\n');
      const own = child.content.split('\n');
      expect(lines[child.lineStart! - 1]).toContain(own[0]);
      expect(lines[child.lineEnd! - 1]).toContain(own.at(-1));
      expect(child.lineEnd! - child.lineStart! + 1).toBe(own.length);
      expect(child.context).toMatch(new RegExp(`^Context \\d+ of ${child.document.path}\\.$`));
      expect(child.headingPath[0]).toBe(child.document.path);
      expect(child.pageStart).toBeNull();
    }

    const service = documents.find((doc) => doc.path === 'src/auth/service.ts')!;
    const serviceLines = service.content.split('\n');
    const login = children.find((child) => child.symbolName === 'AuthService.login')!;
    expect(login.headingPath).toEqual(['src/auth/service.ts', 'class AuthService', 'login']);
    expect(serviceLines[login.lineStart! - 1]).toBe('  async login(user: string) {');
    expect(serviceLines[login.lineEnd! - 1]).toBe('  }');
    expect(children.some((child) => child.symbolName === 'AuthService.logout')).toBe(true);
    const hash = children.find((child) => child.symbolName === 'hashPassword')!;
    // Identifiers are spelled out for keyword search.
    expect(hash.searchText).toContain('hash password');

    const [row] = await prismaClient.$queryRaw<{ withVector: bigint }[]>`
      SELECT count(*) AS "withVector" FROM "SourceChunk"
      WHERE "sourceId" = ${sourceId} AND kind = 'CHILD' AND embedding IS NOT NULL
    `;
    expect(Number(row!.withVector)).toBe(children.length);
    // Packs: far fewer calls than chunks.
    expect(prompts.length).toBeLessThan(children.length);
  });

  it('never stores or sends a secret from the repository', async () => {
    const sourceId = await createRepoSource(workspaceId);
    await ingest(sourceId);

    const settings = (await documentsOf(sourceId)).find(
      (doc) => doc.path === 'config/settings.json',
    )!;
    expect(settings.content).toContain('[REDACTED:aws-access-key]');
    expect(settings.content).toContain('"password": "[REDACTED:generic-secret]"');

    const stored = [
      ...(await prismaClient.sourceDocument.findMany({ select: { content: true, path: true } })),
      ...(await prismaClient.sourceChunk.findMany({
        select: { content: true, searchText: true, context: true },
      })),
      ...(await prismaClient.contextCache.findMany({ select: { context: true } })),
      ...(await prismaClient.ingestDraft.findMany({ select: { data: true } })),
    ].map((row) => JSON.stringify(row));
    const embedded = doEmbed.mock.calls.flatMap(([options]) => options.values);
    const everything = [...stored, ...prompts, ...embedded].join('\n');
    expect(embedded.length).toBeGreaterThan(0);
    for (const secret of Object.values(FIXTURE_SECRETS)) {
      expect(everything).not.toContain(secret);
    }
  });

  it('skips a resync of the same commit without downloading or calling a model', async () => {
    const sourceId = await createRepoSource(workspaceId);
    await ingest(sourceId);
    const before = await prismaClient.sourceChunk.findMany({
      where: { sourceId },
      select: { id: true },
    });
    prompts.length = 0;
    doEmbed.mockClear();
    vi.mocked(downloadTarball).mockClear();

    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'skipped' });
    expect(downloadTarball).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(0);
    expect(doEmbed).not.toHaveBeenCalled();
    const after = await prismaClient.sourceChunk.findMany({
      where: { sourceId },
      select: { id: true },
    });
    expect(after).toEqual(before);
  });

  it('only contextualizes the changed file on a new commit', async () => {
    const sourceId = await createRepoSource(workspaceId);
    await ingest(sourceId);
    prompts.length = 0;

    const changed = {
      ...FIXTURE_FILES,
      'src/util.py': `${FIXTURE_FILES['src/util.py']}\nVERSION = 2\n`,
    };
    serveRepo(fixtureRepoEntries(changed), 'b'.repeat(40));
    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'done' });
    expect((await sourceRow(sourceId)).stats).toMatchObject({ commitSha: 'b'.repeat(40) });
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect([...prompt.matchAll(/<file path="([^"]+)">/g)].map((m) => m[1])).toEqual([
        'src/util.py',
      ]);
    }
  });

  it.each([
    ['no-ref' as const, 'Branch, tag or commit "main" no longer exists'],
    ['no-repo' as const, 'Repository not found. Only public repositories work.'],
    ['empty' as const, 'This repository is empty'],
  ])('fails with a clear message when GitHub answers %s', async (answer, message) => {
    vi.mocked(resolveCommit).mockResolvedValue(answer);
    const sourceId = await createRepoSource(workspaceId);
    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(await sourceRow(sourceId)).toMatchObject({ status: 'FAILED', error: message });
    expect(downloadTarball).not.toHaveBeenCalled();
  });

  it('refuses an archive with unsafe paths, before any model call', async () => {
    serveRepo([...fixtureRepoEntries(), { path: '../evil.sh', content: 'rm -rf /\n', raw: true }]);
    const sourceId = await createRepoSource(workspaceId);
    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect((await sourceRow(sourceId)).error).toBe('The repository archive contains unsafe paths');
    expect(await prismaClient.sourceDocument.count({ where: { sourceId } })).toBe(0);
    expect(prompts).toHaveLength(0);
    expect(doEmbed).not.toHaveBeenCalled();
  });

  it('refuses a repository that needs more chunks than the daily quota allows', async () => {
    const limits = appConfig.ingestion.repo as { maxChildChunks: number };
    const original = limits.maxChildChunks;
    limits.maxChildChunks = 2;
    try {
      const sourceId = await createRepoSource(workspaceId);
      await ingest(sourceId);
      expect((await sourceRow(sourceId)).error).toMatch(
        /needs \d+ search chunks; the limit is 2\./,
      );
      expect(prompts).toHaveLength(0);
    } finally {
      limits.maxChildChunks = original;
    }
  });

  it('spreads the packs over several contextualize steps', async () => {
    const contextualize = appConfig.ingestion.contextualize as {
      packsPerStep: number;
      codeChunksPerCall: number;
    };
    const original = { ...contextualize };
    contextualize.packsPerStep = 1;
    contextualize.codeChunksPerCall = 2;
    try {
      const sourceId = await createRepoSource(workspaceId);
      const { result } = await ingest(sourceId);
      expect(result).toMatchObject({ outcome: 'done', missingContexts: 0 });
      // One call per step, each pack sent once.
      expect(prompts.length).toBeGreaterThan(1);
      const chunks = prompts.flatMap((prompt) => [...prompt.matchAll(/<chunk n=/g)]);
      expect(chunks).toHaveLength(
        await prismaClient.sourceChunk.count({ where: { sourceId, kind: 'CHILD' } }),
      );
    } finally {
      contextualize.packsPerStep = original.packsPerStep;
      contextualize.codeChunksPerCall = original.codeChunksPerCall;
    }
  });
});
