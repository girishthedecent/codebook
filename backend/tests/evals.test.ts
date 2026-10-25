import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import { inngest } from '../src/config/inngest.config.js';
import type { EvalCaseType } from '../src/generated/prisma/enums.js';
import { metricDeltas } from '../src/modules/evals/evals.service.js';
import { testApp } from './helpers/app.js';
import { ORIGIN, signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

type User = Awaited<ReturnType<typeof signedInUser>>;

let admin: User;
let reader: User;
let send: ReturnType<typeof vi.spyOn>;
let cases: Record<string, string>;
let datasetId: string;

const PASSAGE = 'A Bloom filter says for sure when a key is absent.';

async function createRun(fields: {
  suite?: string;
  name: string;
  summary: object;
  dataset?: string;
  startedAt?: Date;
}) {
  return prismaClient.evalRun.create({
    data: {
      datasetId: fields.dataset ?? datasetId,
      suite: fields.suite ?? 'retrieval',
      name: fields.name,
      config: { name: fields.name },
      gitSha: 'abc123',
      split: 'DEV',
      status: 'DONE',
      summary: fields.summary,
      ...(fields.startedAt ? { startedAt: fields.startedAt } : {}),
    },
  });
}

function addResult(runId: string, caseKey: string, fields: Record<string, unknown> = {}) {
  return prismaClient.evalResult.create({
    data: { runId, caseId: cases[caseKey]!, latencyMs: 100, scores: {}, ...fields },
  });
}

beforeEach(async () => {
  await resetDb();
  admin = await signedInUser('admin@example.com');
  reader = await signedInUser('reader@example.com');
  serverConfig.ADMIN_USER_IDS = [admin.userId];
  send = vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] } as never);

  const dataset = await prismaClient.evalDataset.create({ data: { name: 'core' } });
  datasetId = dataset.id;
  const seeds: [string, EvalCaseType, string][] = [
    ['book-001', 'BOOK', 'DEV'],
    ['code-001', 'CODE', 'DEV'],
    ['none-001', 'NO_ANSWER', 'DEV'],
    ['book-101', 'BOOK', 'HELDOUT'],
  ];
  cases = {};
  for (const [externalId, type, split] of seeds) {
    const row = await prismaClient.evalCase.create({
      data: {
        datasetId,
        externalId,
        type,
        split: split as 'DEV' | 'HELDOUT',
        question: `Question ${externalId}`,
        expectedAnswer: 'An answer.',
        expectedRefs: [],
        tags: [],
      },
    });
    cases[externalId] = row.id;
  }
});

afterEach(() => {
  serverConfig.ADMIN_USER_IDS = [];
  vi.restoreAllMocks();
});

describe('admin only', () => {
  const reads = [
    '/api/v1/evals/datasets',
    '/api/v1/evals/runs',
    '/api/v1/evals/runs/cm0000000000000000000000',
    '/api/v1/evals/runs/cm0000000000000000000000/results',
    '/api/v1/evals/compare?runs=a,b',
  ];

  it.each(reads)('answers GET %s with a plain 404 for anyone else', async (url) => {
    const anonymous = await testApp().get(url);
    const signedIn = await reader.agent.get(url);
    for (const res of [anonymous, signedIn]) {
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(`Route not found: GET ${url.split('?')[0]}`);
    }
  });

  it('answers POST /runs with a 404 for anyone else and queues nothing', async () => {
    const body = { suite: 'retrieval', config: 'hybrid' };
    const anonymous = await testApp().post('/api/v1/evals/runs').set('origin', ORIGIN).send(body);
    const signedIn = await reader.agent.post('/api/v1/evals/runs').set('origin', ORIGIN).send(body);

    expect(anonymous.status).toBe(404);
    expect(signedIn.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('datasets and runs', () => {
  it('lists datasets with live case counts', async () => {
    await prismaClient.evalCase.update({
      where: { id: cases['code-001'] },
      data: { retired: true },
    });

    const res = await admin.agent.get('/api/v1/evals/datasets');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        name: 'core',
        cases: 3,
        bySplit: { DEV: 2, HELDOUT: 1 },
        byType: { BOOK: 2, NO_ANSWER: 1 },
      }),
    ]);
  });

  it('lists runs newest first, filtered by suite, with their overall numbers', async () => {
    await createRun({
      name: 'hybrid',
      summary: { overall: { recall5: 0.8 } },
      startedAt: new Date('2026-10-01T00:00:00Z'),
    });
    const newer = await createRun({
      name: 'vector-only',
      summary: { overall: { recall5: 0.9 } },
      startedAt: new Date('2026-10-02T00:00:00Z'),
    });
    await createRun({ suite: 'answer', name: 'adaptive-agent', summary: {} });

    const res = await admin.agent.get('/api/v1/evals/runs?suite=retrieval&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.map((run: { name: string }) => run.name)).toEqual([
      'vector-only',
      'hybrid',
    ]);
    expect(res.body.data[0]).toMatchObject({
      id: newer.id,
      dataset: 'core',
      suite: 'retrieval',
      overall: { recall5: 0.9 },
      costUsd: '0',
    });
    expect((await admin.agent.get('/api/v1/evals/runs?limit=0')).status).toBe(400);
  });

  it('shows one run with its config and result counts, and 404s an unknown one', async () => {
    const run = await createRun({ name: 'hybrid', summary: { overall: { recall5: 1 } } });
    await addResult(run.id, 'book-001');
    await addResult(run.id, 'code-001', { error: 'Timed out' });

    const res = await admin.agent.get(`/api/v1/evals/runs/${run.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'hybrid',
      config: { name: 'hybrid' },
      summary: { overall: { recall5: 1 } },
      counts: { results: 2, errors: 1 },
    });
    const missing = await admin.agent.get('/api/v1/evals/runs/cm0000000000000000000000');
    expect(missing.status).toBe(404);
    expect((await admin.agent.get('/api/v1/evals/runs/not-an-id')).status).toBe(400);
  });
});

describe('GET /runs/:id/results', () => {
  it('shows refs and scores but never the passage text the model was shown', async () => {
    const run = await createRun({ suite: 'answer', name: 'adaptive-agent', summary: {} });
    await addResult(run.id, 'book-001', {
      answer: 'It skips reads for absent keys [1].',
      citations: [{ n: 1, valid: true, supported: true, snippet: PASSAGE, sourceTitle: 'DDIA' }],
      retrieved: {
        passages: [{ n: 1, kind: 'CHUNK', sourceKey: 'book', pageStart: 99, text: PASSAGE }],
      },
      scores: { correctness: 1, faithfulness: 1 },
    });

    const res = await admin.agent.get(`/api/v1/evals/runs/${run.id}/results`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(PASSAGE);
    expect(res.body.data[0]).toMatchObject({
      externalId: 'book-001',
      failed: false,
      score: 1,
      answer: 'It skips reads for absent keys [1].',
      citations: [{ n: 1, valid: true, supported: true, sourceTitle: 'DDIA' }],
      retrieved: { passages: [{ n: 1, sourceKey: 'book', pageStart: 99 }] },
    });
  });

  it('filters by case type and to the failed cases', async () => {
    const run = await createRun({ suite: 'answer', name: 'adaptive-agent', summary: {} });
    await addResult(run.id, 'book-001', { scores: { correctness: 1, faithfulness: 0.5 } });
    await addResult(run.id, 'code-001', { scores: { correctness: 1, faithfulness: 1 } });
    await addResult(run.id, 'none-001', { scores: { noAnswerCorrect: true } });
    await addResult(run.id, 'book-101', { error: 'Timed out' });

    const failed = await admin.agent.get(`/api/v1/evals/runs/${run.id}/results?failed=1`);
    const books = await admin.agent.get(`/api/v1/evals/runs/${run.id}/results?type=BOOK`);

    // book-001 is right but claims more than its passages say.
    expect(failed.body.data.map((row: { externalId: string }) => row.externalId)).toEqual([
      'book-001',
      'book-101',
    ]);
    expect(books.body.data.map((row: { externalId: string }) => row.externalId)).toEqual([
      'book-001',
      'book-101',
    ]);
  });
});

describe('GET /compare', () => {
  it('gives metric deltas and the cases that changed, worst news first', async () => {
    const a = await createRun({
      name: 'hybrid',
      summary: {
        overall: { recall5: 0.5, mrr: 0.4, noAnswerAccuracy: null },
        byType: { BOOK: { recall5: 1 }, CODE: { recall5: 0 } },
      },
    });
    const b = await createRun({
      name: 'hybrid-rerank',
      summary: {
        overall: { recall5: 0.75, mrr: 0.3, noAnswerAccuracy: 1 },
        byType: { BOOK: { recall5: 0.5 }, CODE: { recall5: 1 } },
      },
    });
    await addResult(a.id, 'book-001', { scores: { recall5: 1 } });
    await addResult(b.id, 'book-001', { scores: { recall5: 0.5 } });
    await addResult(a.id, 'code-001', { scores: { recall5: 0 } });
    await addResult(b.id, 'code-001', { scores: { recall5: 1 } });
    await addResult(a.id, 'none-001', { scores: { weak: true } });
    await addResult(b.id, 'none-001', { error: 'Timed out' });
    await addResult(a.id, 'book-101', { scores: { recall5: 1 } });
    await addResult(b.id, 'book-101', { scores: { recall5: 1 } });

    const res = await admin.agent.get(`/api/v1/evals/compare?runs=${a.id},${b.id}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.overall.recall5).toEqual({ a: 0.5, b: 0.75, delta: 0.25 });
    expect(data.overall.mrr.delta).toBeCloseTo(-0.1);
    expect(data.overall.noAnswerAccuracy).toEqual({ a: null, b: 1, delta: null });
    expect(data.byType.CODE.recall5.delta).toBe(1);
    expect(data.counts).toMatchObject({ broke: 1, worse: 1, better: 1, same: 1 });
    expect(data.cases.map((item: { externalId: string; change: string }) => item.change)).toEqual([
      'broke',
      'worse',
      'better',
    ]);
    expect(data.cases[1]).toMatchObject({
      externalId: 'book-001',
      a: { score: 1, error: null },
      b: { score: 0.5, error: null },
    });
  });

  it('refuses runs of different suites or datasets, and bad ids', async () => {
    const retrieval = await createRun({ name: 'hybrid', summary: {} });
    const answer = await createRun({ suite: 'answer', name: 'adaptive-agent', summary: {} });
    const other = await prismaClient.evalDataset.create({ data: { name: 'other' } });
    const elsewhere = await createRun({ name: 'hybrid', summary: {}, dataset: other.id });

    const suites = await admin.agent.get(`/api/v1/evals/compare?runs=${retrieval.id},${answer.id}`);
    const datasets = await admin.agent.get(
      `/api/v1/evals/compare?runs=${retrieval.id},${elsewhere.id}`,
    );
    const same = await admin.agent.get(
      `/api/v1/evals/compare?runs=${retrieval.id},${retrieval.id}`,
    );
    const missing = await admin.agent.get(
      `/api/v1/evals/compare?runs=${retrieval.id},cm0000000000000000000000`,
    );

    expect(suites.status).toBe(400);
    expect(datasets.status).toBe(400);
    expect(same.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it('lines up every number in two metric objects', () => {
    expect(metricDeltas({ x: 1, y: 'n/a', z: 2 }, { x: 3, w: 1 })).toEqual({
      x: { a: 1, b: 3, delta: 2 },
      z: { a: 2, b: null, delta: null },
      w: { a: null, b: 1, delta: null },
    });
    expect(metricDeltas(null, undefined)).toEqual({});
  });
});

describe('POST /runs', () => {
  it('queues a run for the eval worker with who asked for it', async () => {
    const res = await admin.agent
      .post('/api/v1/evals/runs')
      .set('origin', ORIGIN)
      .send({ suite: 'answer', config: 'static-rag', limit: 10, tags: ['gate'] });

    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({
      suite: 'answer',
      config: 'static-rag',
      status: 'queued',
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'eval/run.requested',
        data: {
          suite: 'answer',
          config: 'static-rag',
          dataset: 'core',
          split: 'DEV',
          limit: 10,
          tags: ['gate'],
          requestedBy: admin.userId,
        },
      }),
    );
  });

  it('refuses with 409 while a run is going, but not because of a run long dead', async () => {
    const going = await createRun({ name: 'hybrid', summary: {} });
    await prismaClient.evalRun.update({ where: { id: going.id }, data: { status: 'RUNNING' } });
    const body = { suite: 'retrieval', config: 'hybrid' };

    const busy = await admin.agent.post('/api/v1/evals/runs').set('origin', ORIGIN).send(body);
    expect(busy.status).toBe(409);
    expect(busy.body.message).toContain(going.id);
    expect(send).not.toHaveBeenCalled();

    // No result and started hours ago: the worker sweeps it when the next run starts.
    await prismaClient.evalRun.update({
      where: { id: going.id },
      data: { startedAt: new Date(Date.now() - 3 * 60 * 60_000) },
    });
    const later = await admin.agent.post('/api/v1/evals/runs').set('origin', ORIGIN).send(body);
    expect(later.status).toBe(202);
  });

  it('refuses names that could not be file names', async () => {
    for (const body of [
      { suite: 'answer', config: '../secrets' },
      { suite: 'Answer', config: 'hybrid' },
      { suite: 'answer', config: 'hybrid', split: 'TRAIN' },
      { suite: 'answer', config: 'hybrid', resume: 'not-a-run' },
    ]) {
      const res = await admin.agent.post('/api/v1/evals/runs').set('origin', ORIGIN).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });
});
