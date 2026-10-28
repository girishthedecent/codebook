import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { embedTexts } from '../src/llm/embeddings.js';
import type { RetrievedChunk, SearchResult } from '../src/modules/retrieval/retrieval.types.js';
import { search } from '../src/modules/retrieval/retrieval.service.js';
import { resetDb } from '../tests/helpers/db.js';
import { retrievalConfigSchema } from './config.js';
import { loadCorpus } from './corpusWorkspace.js';
import { evalCaseSchema, importCases, type EvalCaseInput } from './dataset.js';
import { latestFile, loadRuns, writeReport } from './reportMarkdown.js';
import { codeVersion, gitSha, resumeConflict, runRetrieval } from './retrievalSuite.js';

vi.mock('../src/modules/retrieval/retrieval.service.js', () => ({ search: vi.fn() }));
vi.mock('./corpusWorkspace.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./corpusWorkspace.js')>()),
  loadCorpus: vi.fn(),
}));
vi.mock('../src/llm/embeddings.js', () => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
}));
vi.mock('../src/utils/pacer.js', () => import('../tests/helpers/no-pacing.js'));

const searchMock = vi.mocked(search);

const cases: EvalCaseInput[] = [
  {
    id: 'book-001',
    type: 'BOOK',
    split: 'DEV',
    question: 'Why do leaders need fencing tokens?',
    expectedAnswer: 'A paused old leader could otherwise keep writing.',
    expectedRefs: [{ sourceKey: 'book', pageStart: 10, pageEnd: 11 }],
    tags: ['consensus'],
    reviewed: true,
  },
  {
    id: 'code-001',
    type: 'CODE',
    split: 'DEV',
    question: 'Where does the router match a path?',
    expectedAnswer: 'In the layer match function.',
    expectedRefs: [{ sourceKey: 'repo', path: 'lib/router.js', lineStart: 10, lineEnd: 20 }],
    tags: [],
    reviewed: false,
  },
  {
    id: 'none-001',
    type: 'NO_ANSWER',
    split: 'DEV',
    question: 'How do I deploy to the moon?',
    expectedAnswer: 'The corpus does not say.',
    expectedRefs: [],
    tags: [],
    reviewed: false,
  },
].map((item) => evalCaseSchema.parse(item));

function chunk(id: string, sourceId: string, fields: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    chunkId: id,
    parentId: null,
    sourceId,
    sourceTitle: sourceId,
    sourceType: sourceId === 'src-book' ? 'PDF' : 'GITHUB_REPO',
    documentPath: sourceId === 'src-book' ? 'book.pdf' : 'lib/router.js',
    headingPath: [],
    symbolName: null,
    pageStart: null,
    pageEnd: null,
    lineStart: null,
    lineEnd: null,
    content: 'text',
    context: null,
    scores: { rrf: 0.03 },
    ...fields,
  };
}

function answer(results: RetrievedChunk[], weak = false): SearchResult {
  return {
    results,
    parents: [],
    debug: {
      weak,
      keywordOnly: false,
      ranked: results.map((item) => item.chunkId),
      rerank: 'used',
      fallbackUsed: false,
      queries: [],
      candidates: { vector: results.length, keyword: 0, fused: results.length },
      timings: { embed: 5, vector: 10, keyword: 5, rerank: 20, parents: 0, total: 40 },
    },
  };
}

const config = retrievalConfigSchema.parse({
  name: 'hybrid-rerank',
  search: { mode: 'hybrid', rerank: true },
});

let reportDir: string;

beforeEach(async () => {
  await resetDb();
  searchMock.mockReset();
  vi.mocked(embedTexts).mockClear();
  const user = await prismaClient.user.create({
    data: { id: 'eval-user', name: 'Eval', email: 'eval@example.com', isSystem: true },
  });
  vi.mocked(loadCorpus).mockResolvedValue({
    userId: user.id,
    workspaceId: 'ws-eval',
    corpusVersion: 'v1',
    sources: [
      { sourceKey: 'book', sourceId: 'src-book', type: 'PDF', status: 'READY' },
      { sourceKey: 'repo', sourceId: 'src-repo', type: 'GITHUB_REPO', status: 'READY' },
    ],
  });
  await importCases('core', cases);
  reportDir = await mkdtemp(join(tmpdir(), 'codebook-report-'));
});

afterAll(async () => {
  if (reportDir) await rm(reportDir, { recursive: true, force: true });
});

describe('retrieval runner', () => {
  it('stores a run with one scored result per case, resumes failed cases, and reports', async () => {
    searchMock.mockImplementation(async ({ query }) => {
      if (query.startsWith('Why')) {
        return answer([
          chunk('c1', 'src-book', { pageStart: 30, pageEnd: 30 }),
          chunk('c2', 'src-book', { pageStart: 11, pageEnd: 12 }),
        ]);
      }
      if (query.startsWith('Where')) throw new Error('model quota');
      return answer([], true);
    });

    const first = await runRetrieval({ dataset: 'core', config, split: 'DEV' });

    const run = await prismaClient.evalRun.findUniqueOrThrow({ where: { id: first.runId } });
    expect(run).toMatchObject({ suite: 'retrieval', name: 'hybrid-rerank', status: 'DONE' });
    expect(run.gitSha).toMatch(/^([0-9a-f]{40}(-dirty-[0-9a-f]{8})?|unknown)$/);
    // Every question was embedded once, up front, before the first search.
    expect(vi.mocked(embedTexts)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embedTexts).mock.calls[0]![0]).toHaveLength(3);
    expect(vi.mocked(embedTexts).mock.invocationCallOrder[0]).toBeLessThan(
      searchMock.mock.invocationCallOrder[0]!,
    );
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'eval-user',
        workspaceId: 'ws-eval',
        topK: 20,
        expandParents: false,
      }),
    );

    const results = await prismaClient.evalResult.findMany({
      where: { runId: first.runId },
      include: { case: true },
    });
    const byId = new Map(results.map((result) => [result.case.externalId, result]));
    expect(byId.get('book-001')?.scores).toMatchObject({ recall5: 1, mrr: 0.5, weak: false });
    expect(byId.get('code-001')?.error).toBe('model quota');
    expect(byId.get('none-001')?.scores).toMatchObject({ answerable: false, weak: true });
    expect(first.summary.overall).toMatchObject({
      cases: 3,
      errors: 1,
      recall5: 0.5,
      noAnswerAccuracy: 1,
    });

    // The failed case runs again; the finished ones are kept.
    searchMock.mockClear();
    searchMock.mockImplementation(async () =>
      answer([chunk('c3', 'src-repo', { lineStart: 15, lineEnd: 25 })]),
    );
    const resumed = await runRetrieval({
      dataset: 'core',
      config,
      split: 'DEV',
      resume: first.runId,
    });
    expect(resumed.runId).toBe(first.runId);
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock.mock.calls[0]![0].query).toMatch(/^Where/);
    expect(resumed.summary.overall).toMatchObject({ errors: 0, recall5: 1 });
    expect(await prismaClient.evalResult.count({ where: { runId: first.runId } })).toBe(3);

    const file = await writeReport(await loadRuns(), reportDir, new Date('2026-10-24T12:00:00Z'));
    expect(file).toBe(join(reportDir, '2026-10-24-retrieval-dev.md'));
    const markdown = await readFile(join(reportDir, 'latest.md'), 'utf8');
    expect(markdown).toContain('# Retrieval evals, 2026-10-24');
    expect(markdown).toMatch(/\| hybrid-rerank \| 3 \| 1\.000 \|/);
    expect(markdown).toContain('## By case type');
    expect(markdown).toContain('## Worst cases of hybrid-rerank');
  });

  it('marks a case tainted when the reranker was unavailable', async () => {
    searchMock.mockImplementation(async () => {
      const result = answer([chunk('c1', 'src-book', { pageStart: 10, pageEnd: 10 })]);
      return { ...result, debug: { ...result.debug, rerank: 'unavailable' } };
    });

    const { summary } = await runRetrieval({ dataset: 'core', config, split: 'DEV', limit: 1 });

    expect(summary.taintedCases).toBe(1);
  });

  it('never runs a case that is gone from the dataset file', async () => {
    searchMock.mockImplementation(async () => answer([]));
    await importCases('core', [cases[0]!, cases[2]!]);

    await runRetrieval({ dataset: 'core', config, split: 'DEV' });

    const asked = searchMock.mock.calls.map(([options]) => options.query);
    expect(asked).toHaveLength(2);
    expect(asked.some((query) => query.startsWith('Where'))).toBe(false);
  });

  it('refuses to resume a run whose config changed', async () => {
    searchMock.mockImplementation(async () => answer([]));
    const { runId } = await runRetrieval({ dataset: 'core', config, split: 'DEV', limit: 1 });

    const changed = { ...config, search: { ...config.search, topK: 10 } };
    await expect(
      runRetrieval({ dataset: 'core', config: changed, split: 'DEV', resume: runId }),
    ).rejects.toThrow(/config has changed/);
    // The same config resumes.
    await runRetrieval({ dataset: 'core', config, split: 'DEV', resume: runId });
  });

  it('refuses to resume once the cases it ran on have changed', async () => {
    searchMock.mockImplementation(async () => answer([]));
    const { runId } = await runRetrieval({ dataset: 'core', config, split: 'DEV' });

    await importCases('core', [
      { ...cases[0]!, question: 'Why do leaders need fencing?' },
      ...cases.slice(1),
    ]);

    await expect(
      runRetrieval({ dataset: 'core', config, split: 'DEV', resume: runId }),
    ).rejects.toThrow(/cases have changed/);
  });

  it('refuses a reranker model without score thresholds', () => {
    const parsed = retrievalConfigSchema.safeParse({
      name: 'typo',
      search: { mode: 'hybrid', rerank: true, rerankerModel: 'Xenova/no-such-reranker' },
    });
    expect(parsed.success).toBe(false);
    expect(
      retrievalConfigSchema.safeParse({
        name: 'bge',
        search: { mode: 'hybrid', rerank: true, rerankerModel: 'Xenova/bge-reranker-base' },
      }).success,
    ).toBe(true);
  });

  it('writes a held-out report to its own latest file', async () => {
    const file = await writeReport([], reportDir, new Date('2026-10-24T12:00:00Z'), 'HELDOUT');

    expect(file).toBe(join(reportDir, '2026-10-24-retrieval-heldout.md'));
    expect(latestFile('HELDOUT', reportDir)).toBe(join(reportDir, 'latest-heldout.md'));
    expect(await readFile(join(reportDir, 'latest-heldout.md'), 'utf8')).toContain(
      'No finished runs',
    );
  });

  it('reports the latest full run of each config on one split, skipping partial runs', async () => {
    searchMock.mockImplementation(async () => answer([]));
    const full = await runRetrieval({ dataset: 'core', config, split: 'DEV' });
    await runRetrieval({ dataset: 'core', config, split: 'DEV', limit: 1 });
    await runRetrieval({ dataset: 'core', config, split: 'DEV', tags: ['consensus'] });

    expect((await loadRuns()).map((run) => run.id)).toEqual([full.runId]);
    expect(await loadRuns(undefined, { split: 'HELDOUT' })).toEqual([]);
    expect(await loadRuns(undefined, { dataset: 'other' })).toEqual([]);
  });

  it('refuses a corpus that is not ready, before creating a run', async () => {
    vi.mocked(loadCorpus).mockResolvedValueOnce({
      userId: 'eval-user',
      workspaceId: 'ws-eval',
      corpusVersion: 'v1',
      sources: [{ sourceKey: 'book', sourceId: 'src-book', type: 'PDF', status: 'PROCESSING' }],
    });

    await expect(runRetrieval({ dataset: 'core', config, split: 'DEV' })).rejects.toThrow(
      /book \(PROCESSING\)/,
    );
    expect(await prismaClient.evalRun.count()).toBe(0);
  });
});

describe('dataset import', () => {
  it('upserts by id and retires cases missing from the file, until they come back', async () => {
    const { missing } = await importCases('core', [{ ...cases[0]!, question: 'Changed?' }]);
    expect(missing).toEqual(['code-001', 'none-001']);
    const stored = await prismaClient.evalCase.findMany({ orderBy: { externalId: 'asc' } });
    expect(stored).toHaveLength(3);
    expect(stored.map((row) => [row.externalId, row.retired])).toEqual([
      ['book-001', false],
      ['code-001', true],
      ['none-001', true],
    ]);
    expect(stored[0]).toMatchObject({ question: 'Changed?', reviewed: true });

    await importCases('core', cases);
    expect(await prismaClient.evalCase.count({ where: { retired: true } })).toBe(0);
  });
});

describe('resumeConflict', () => {
  const minilm = 'Xenova/ms-marco-MiniLM-L-6-v2';
  const current = {
    datasetId: 'd1',
    config,
    corpusVersion: 'v1',
    gitSha: 'abc',
    casesHash: 'h1',
    rerankerModel: minilm,
  };
  // As it comes back from jsonb: keys in another order, plus what the runner adds.
  const stored = {
    datasetId: 'd1',
    gitSha: 'abc',
    models: { embedding: {}, reranker: minilm, queryMode: null },
    config: {
      ...Object.fromEntries(Object.entries(config).reverse()),
      selection: { split: 'DEV' },
      casesHash: 'h1',
      corpus: { corpusVersion: 'v1' },
    },
  };

  it('accepts the same settings whatever the key order', () => {
    expect(resumeConflict(stored, current)).toBeNull();
  });

  it('names what changed', () => {
    expect(resumeConflict({ ...stored, datasetId: 'd2' }, current)).toMatch(/another dataset/);
    expect(resumeConflict(stored, { ...current, corpusVersion: 'v2' })).toMatch(/corpus/);
    expect(resumeConflict(stored, { ...current, gitSha: 'def' })).toMatch(/code abc/);
    const timeout = { ...config, timeoutMs: 5_000 };
    expect(resumeConflict(stored, { ...current, config: timeout })).toMatch(/config/);
    expect(resumeConflict(stored, { ...current, casesHash: 'h2' })).toMatch(/cases/);
    expect(
      resumeConflict(stored, { ...current, rerankerModel: 'Xenova/bge-reranker-base' }),
    ).toMatch(/reranked with Xenova\/ms-marco/);
    expect(resumeConflict(stored, { ...current, rerankerModel: null })).toMatch(/none/);
  });

  it('is fed the same git sha the run stored', () => {
    expect(gitSha()).toBe(gitSha());
  });
});

describe('codeVersion', () => {
  const file = (path: string, text: string) => ({ path, content: Buffer.from(text) });

  it('is HEAD for a clean tree', () => {
    expect(codeVersion('abc', '', [])).toBe('abc');
  });

  it('tells different uncommitted changes apart', () => {
    const one = codeVersion('abc', 'diff --git a b\n+x', []);
    expect(one).toMatch(/^abc-dirty-[0-9a-f]{8}$/);
    expect(codeVersion('abc', 'diff --git a b\n+y', [])).not.toBe(one);
    // An untracked file counts by its content, not only its name.
    const added = codeVersion('abc', '', [file('evals/new.ts', 'a')]);
    expect(codeVersion('abc', '', [file('evals/new.ts', 'b')])).not.toBe(added);
    expect(codeVersion('abc', '', [file('evals/new.ts', 'a')])).toBe(added);
  });
});
