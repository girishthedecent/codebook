import type { Agent } from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { textRoutes } from '../src/llm/models.js';
import { downloadTarball, resolveCommit } from '../src/utils/github.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import { GRAPH_FILES } from './helpers/graphRepo.js';
import {
  codeContextReply,
  createPdfSource,
  createRepoSource,
  ingest,
} from './helpers/ingestion.js';
import { promptModel, useModels } from './helpers/llm-mock.js';
import { buildTarball } from './helpers/repo.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));
vi.mock('../src/utils/github.js', () => ({
  resolveCommit: vi.fn(),
  downloadTarball: vi.fn(),
}));

type Symbol = {
  id: string;
  name: string;
  qualifiedName: string;
  kind: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  chunkId: string | null;
  depth?: number;
  via?: string | null;
};

let alice: Agent;
let aliceId: string;
let workspaceId: string;
let sourceId: string;

function serve(files: Record<string, string>, sha: string) {
  vi.mocked(resolveCommit).mockResolvedValue({ sha });
  vi.mocked(downloadTarball).mockImplementation(
    async () =>
      new Response(
        buildTarball(Object.entries(files).map(([path, content]) => ({ path, content }))),
      ).body!,
  );
}

beforeEach(async () => {
  await resetDb();
  ({ agent: alice, userId: aliceId } = await signedInUser('alice@example.com'));
  const res = await alice.post('/api/v1/workspaces').send({ name: 'Graph' });
  workspaceId = (res.body as { data: { id: string } }).data.id;
  useModels({ [textRoutes.contextualize.primary.model]: promptModel(codeContextReply) });
  serve(GRAPH_FILES, 'a'.repeat(40));
  sourceId = await createRepoSource(workspaceId);
  await ingest(sourceId);
});

const graph = (path: string) => alice.get(`/api/v1/sources/${sourceId}/graph/${path}`);
const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;

describe('code graph', () => {
  it('stores symbols with their lines and chunks, and resolution counts', async () => {
    const symbols = await prismaClient.codeSymbol.findMany({ where: { sourceId } });
    const byName = new Map(symbols.map((symbol) => [symbol.qualifiedName, symbol]));

    expect(
      byName.get('src/repositories/userRepository.ts#UserRepository.findByEmail'),
    ).toMatchObject({
      kind: 'METHOD',
      name: 'findByEmail',
      lineStart: 5,
      lineEnd: 8,
      exported: true,
    });
    expect(byName.get('src/routes/auth.ts#loginHandler')).toMatchObject({
      kind: 'FUNCTION',
      lineStart: 6,
    });
    expect(byName.get('src/types.ts#Authenticator')).toMatchObject({ kind: 'INTERFACE' });
    expect(byName.get('src/db.ts')).toMatchObject({ kind: 'FILE', name: 'db.ts', lineEnd: 8 });

    // Each code symbol cites the chunk holding its first line.
    const handler = byName.get('src/routes/auth.ts#loginHandler')!;
    const chunk = await prismaClient.sourceChunk.findUniqueOrThrow({
      where: { id: handler.chunkId! },
    });
    expect(chunk.lineStart).toBeLessThanOrEqual(6);
    expect(chunk.lineEnd).toBeGreaterThanOrEqual(6);

    const source = await prismaClient.source.findUniqueOrThrow({ where: { id: sourceId } });
    expect((source.stats as { graph: unknown }).graph).toMatchObject({
      symbols: symbols.length,
      calls: 8,
      callsResolved: 6,
      imports: 12,
      importsResolved: 10,
    });
  });

  it('resolves imports, re-exports, inheritance and unresolved packages', async () => {
    const edges = await prismaClient.codeEdge.findMany({
      where: { sourceId, type: { not: 'DEFINES' } },
      include: { from: true, to: true },
    });
    const view = edges.map(
      (edge) =>
        `${edge.type} ${edge.from.qualifiedName} -> ${edge.to?.qualifiedName ?? `?${edge.toName}`}`,
    );
    expect(view).toEqual(
      expect.arrayContaining([
        'IMPORTS src/services/authService.ts -> src/repositories/index.ts',
        'IMPORTS src/services/authService.ts -> ?bcrypt',
        'EXTENDS src/repositories/userRepository.ts#UserRepository -> src/repositories/baseRepository.ts#BaseRepository',
        'IMPLEMENTS src/services/authService.ts#AuthService -> src/types.ts#Authenticator',
        // Through the barrel file and the constructor's parameter property.
        'CALLS src/services/authService.ts#AuthService.login -> src/repositories/userRepository.ts#UserRepository.findByEmail',
        // Inherited.
        'CALLS src/repositories/userRepository.ts#UserRepository.findByEmail -> src/repositories/baseRepository.ts#BaseRepository.first',
        'CALLS src/services/authService.ts#AuthService.login -> ?bcrypt.compare',
        // A package method with the same name as the file's function stays unresolved.
        'CALLS src/db.ts#query -> ?pool.query',
      ]),
    );
  });

  it('lists callers by depth', async () => {
    const res = await graph('callers?symbol=findByEmail&depth=2');
    expect(res.status).toBe(200);
    const { symbol, symbols } = data<{ symbol: Symbol; symbols: Symbol[] }>(res);
    expect(symbol.qualifiedName).toBe(
      'src/repositories/userRepository.ts#UserRepository.findByEmail',
    );
    const login = symbols.find((s) => s.name === 'login')!;
    expect(symbols.map((s) => [s.qualifiedName, s.depth])).toEqual([
      ['src/services/authService.ts#AuthService.login', 1],
      ['src/routes/auth.ts#loginHandler', 2],
    ]);
    expect(symbols[1]!.via).toBe(login.id);
    expect(symbols[0]).toMatchObject({ filePath: 'src/services/authService.ts', lineStart: 8 });
  });

  it('finds the call path from the handler to the database', async () => {
    const res = await graph('path?from=loginHandler&to=src/db.ts%23query');
    expect(res.status).toBe(200);
    const { path } = data<{ path: Symbol[] }>(res);
    expect(path.map((s) => s.qualifiedName)).toEqual([
      'src/routes/auth.ts#loginHandler',
      'src/services/authService.ts#AuthService.login',
      'src/repositories/userRepository.ts#UserRepository.findByEmail',
      'src/db.ts#query',
    ]);

    const none = await graph('path?from=src/db.ts%23query&to=loginHandler');
    expect(data<{ path: null }>(none).path).toBeNull();
  });

  it('stops at the depth cap on a cycle', async () => {
    const res = await graph('callers?symbol=a&depth=3');
    const { symbols } = data<{ symbols: Symbol[] }>(res);
    expect(symbols.map((s) => [s.name, s.depth])).toEqual([['b', 1]]);
  });

  it('lists dependencies with the calls that leave the repository', async () => {
    const res = await graph(
      'dependencies?symbol=src/services/authService.ts%23AuthService.login&depth=1',
    );
    const { symbols, external } = data<{ symbols: Symbol[]; external: { toName: string }[] }>(res);
    expect(symbols.map((s) => s.name)).toEqual(['findByEmail']);
    expect(external.map((edge) => edge.toName)).toEqual(['bcrypt.compare']);

    const file = await graph('dependencies?symbol=src/services/authService.ts&depth=1');
    expect(data<{ symbols: Symbol[] }>(file).symbols.map((s) => s.qualifiedName)).toEqual(
      expect.arrayContaining(['src/repositories/index.ts', 'src/types.ts']),
    );
  });

  it('searches symbols, exact names first', async () => {
    const res = await graph('symbols?q=UserRepository');
    const symbols = data<Symbol[]>(res);
    expect(symbols[0]!.qualifiedName).toBe('src/repositories/userRepository.ts#UserRepository');
    expect(symbols.at(-1)!.kind).toBe('FILE');

    // `_` and `%` are matched literally.
    expect(data<Symbol[]>(await graph('symbols?q=%25'))).toEqual([]);
  });

  it('answers 409 with candidates for a shared name, 404 for an unknown one', async () => {
    const ambiguous = await graph('callers?symbol=login');
    expect(ambiguous.status).toBe(409);
    const candidates = (ambiguous.body as { details: { candidates: Symbol[] } }).details.candidates;
    expect(candidates.map((s) => s.qualifiedName).sort()).toEqual([
      'src/services/authService.ts#AuthService.login',
      'src/types.ts#Authenticator.login',
    ]);

    expect((await graph('callers?symbol=nothingHere')).status).toBe(404);
    expect((await graph('callers?symbol=a&depth=9')).status).toBe(400);
  });

  it('keeps other users and PDFs out', async () => {
    const bob = await signedInUser('bob@example.com');
    const res = await bob.agent.get(`/api/v1/sources/${sourceId}/graph/symbols?q=a`);
    expect(res.status).toBe(404);

    const pdfId = await createPdfSource(aliceId, workspaceId);
    const pdf = await alice.get(`/api/v1/sources/${pdfId}/graph/symbols?q=a`);
    expect(pdf.status).toBe(400);
  });

  it('replaces the graph on a resync with new code', async () => {
    serve(
      { ...GRAPH_FILES, 'src/cycle/c.ts': 'export function c() {\n  return 1;\n}\n' },
      'b'.repeat(40),
    );
    await ingest(sourceId);
    const names = (await prismaClient.codeSymbol.findMany({ where: { sourceId } })).map(
      (s) => s.qualifiedName,
    );
    expect(names).toContain('src/cycle/c.ts#c');
    expect(new Set(names).size).toBe(names.length);
    expect(await prismaClient.ingestDraft.count()).toBe(0);
  });

  it('drops the symbols and edges of a removed file on a resync', async () => {
    const { 'src/cycle/b.ts': _removed, ...rest } = GRAPH_FILES;
    serve(rest, 'b'.repeat(40));
    await ingest(sourceId);

    const symbols = await prismaClient.codeSymbol.findMany({ where: { sourceId } });
    expect(symbols.filter((s) => s.filePath === 'src/cycle/b.ts')).toEqual([]);

    const ids = new Set(symbols.map((s) => s.id));
    const edges = await prismaClient.codeEdge.findMany({ where: { sourceId } });
    for (const edge of edges) {
      expect(ids.has(edge.fromSymbolId)).toBe(true);
      if (edge.toSymbolId) expect(ids.has(edge.toSymbolId)).toBe(true);
    }

    const a = symbols.find((s) => s.qualifiedName === 'src/cycle/a.ts#a')!;
    const call = edges.find((e) => e.type === 'CALLS' && e.fromSymbolId === a.id)!;
    expect(call).toMatchObject({ toSymbolId: null, toName: 'b' });

    // Same as indexing those files from scratch.
    const fresh = await createRepoSource(workspaceId, 'dev');
    await ingest(fresh);
    expect(await prismaClient.codeEdge.count({ where: { sourceId: fresh } })).toBe(edges.length);
    expect(await prismaClient.codeSymbol.count({ where: { sourceId: fresh } })).toBe(
      symbols.length,
    );
  });

  it('keeps the old graph when a resync fails', async () => {
    const before = await prismaClient.codeSymbol.count({ where: { sourceId } });
    vi.mocked(resolveCommit).mockResolvedValue('no-ref');
    const { result } = await ingest(sourceId);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(await prismaClient.codeSymbol.count({ where: { sourceId } })).toBe(before);
    const source = await prismaClient.source.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.status).toBe('FAILED');
    expect(source.error).toMatch(/no longer exists/);
  });

  it("lets another signed-in user read a demo workspace's graph", async () => {
    const bob = await signedInUser('bob@example.com');
    const url = `/api/v1/sources/${sourceId}/graph/symbols?q=UserRepository`;
    expect((await bob.agent.get(url)).status).toBe(404);

    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });

    const res = await bob.agent.get(url);
    expect(res.status).toBe(200);
    expect(data<Symbol[]>(res)[0]!.qualifiedName).toBe(
      'src/repositories/userRepository.ts#UserRepository',
    );
  });

  it('deletes every row of the source with its workspace', async () => {
    expect(await prismaClient.sourceDocument.count({ where: { sourceId } })).toBeGreaterThan(0);
    expect(await prismaClient.sourceChunk.count({ where: { sourceId } })).toBeGreaterThan(0);
    expect(await prismaClient.codeSymbol.count({ where: { sourceId } })).toBeGreaterThan(0);
    expect(await prismaClient.codeEdge.count({ where: { sourceId } })).toBeGreaterThan(0);

    const res = await alice.delete(`/api/v1/workspaces/${workspaceId}`);
    expect(res.status).toBeLessThan(300);

    const where = { where: { sourceId } };
    expect(await prismaClient.sourceDocument.count(where)).toBe(0);
    expect(await prismaClient.tocNode.count(where)).toBe(0);
    expect(await prismaClient.sourceChunk.count(where)).toBe(0);
    expect(await prismaClient.codeSymbol.count(where)).toBe(0);
    expect(await prismaClient.codeEdge.count(where)).toBe(0);
    expect(await prismaClient.ingestDraft.count(where)).toBe(0);
  });
});
