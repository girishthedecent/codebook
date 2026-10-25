import { InngestTestEngine } from '@inngest/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { RUN_STALE_AFTER_MS } from '../src/modules/evals/evals.repository.js';
import { resetDb } from '../tests/helpers/db.js';
import { createRunEval, onRunEvalFailure } from './runEval.function.js';
import { claimRunSlot, tagWorkerRun } from './runGuard.js';
import type { EvalSuite } from './suite.types.js';

const request = {
  suite: 'fake',
  config: 'hybrid',
  dataset: 'core',
  split: 'DEV' as const,
  limit: 3,
  requestedBy: 'admin-1',
};

let datasetId: string;
let caseId: string;

beforeEach(async () => {
  await resetDb();
  const dataset = await prismaClient.evalDataset.create({ data: { name: 'core' } });
  datasetId = dataset.id;
  const evalCase = await prismaClient.evalCase.create({
    data: {
      datasetId,
      externalId: 'book-001',
      type: 'BOOK',
      split: 'DEV',
      question: 'Why?',
      expectedAnswer: 'Because.',
      expectedRefs: [],
      tags: [],
    },
  });
  caseId = evalCase.id;
});

function createRun(name = 'hybrid', startedAt = new Date()) {
  return prismaClient.evalRun.create({
    data: {
      datasetId,
      suite: 'retrieval',
      name,
      config: {},
      gitSha: 'abc',
      split: 'DEV',
      startedAt,
    },
  });
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

function fakeSuite(overrides: Partial<EvalSuite> = {}, caseIds = ['a', 'b', 'c'], gapMs = 5_000) {
  const ran: string[] = [];
  let runId = '';
  const suite: EvalSuite = {
    suite: 'fake',
    configNames: async () => ['hybrid'],
    start: vi.fn(async () => {
      runId = (await createRun()).id;
      return { runId, caseIds, gapMs };
    }),
    runCase: vi.fn(async (_runId: string, id: string) => {
      ran.push(id);
      return { line: id };
    }),
    finish: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    ...overrides,
  };
  return { suite, ran, runId: () => runId };
}

// The test engine stops at a sleep unless the sleep is mocked.
const passGaps = (...ids: string[]) => ids.map((id) => ({ id: `gap-${id}`, handler() {} }));

function run(suite: EvalSuite, data: object = request, steps = passGaps('a', 'b')) {
  const engine = new InngestTestEngine({
    function: createRunEval({ fake: suite }),
    events: [{ name: 'eval/run.requested', data }],
    steps,
  });
  return engine.execute();
}

const errorText = (error: unknown) => String((error as Error | undefined)?.message);

describe('runEval', () => {
  it('is a singleton: a run sleeping between cases still keeps others out', () => {
    expect(createRunEval({}).opts.singleton).toEqual({ mode: 'skip' });
  });

  it('starts the run, runs each case in its own step, spaced by the gap, then finishes', async () => {
    const { suite, ran, runId } = fakeSuite();

    const { result, ctx } = await run(suite);

    expect(result).toEqual({ runId: runId(), cases: 3 });
    expect(suite.start).toHaveBeenCalledWith({
      config: 'hybrid',
      dataset: 'core',
      split: 'DEV',
      limit: 3,
    });
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(ctx.step.run).toHaveBeenCalledWith('case-b', expect.any(Function));
    // Between cases only, and less the time the case itself took.
    const sleeps = vi.mocked(ctx.step.sleep).mock.calls;
    expect(sleeps.map(([id]) => id)).toEqual(['gap-a', 'gap-b']);
    for (const [, ms] of sleeps) {
      expect(ms).toBeGreaterThan(4_000);
      expect(ms).toBeLessThanOrEqual(5_000);
    }
    expect(suite.finish).toHaveBeenCalledWith(runId());
    expect(suite.fail).not.toHaveBeenCalled();
    // Tagged with the function run, for the failure handler.
    const row = await prismaClient.evalRun.findUniqueOrThrow({ where: { id: runId() } });
    expect(row.notes).toMatch(/^Worker run \S+$/);
  });

  it('does not sleep when the config has no gap', async () => {
    const { suite } = fakeSuite({}, ['a', 'b'], 0);

    const { ctx } = await run(suite);

    expect(ctx.step.sleep).not.toHaveBeenCalled();
    expect(suite.finish).toHaveBeenCalled();
  });

  // The engine stops at the first step error (it doesn't model retries), and a mocked step
  // that throws comes back as undefined data in @inngest/test 1.0, so the `fail` step after
  // a step that failed for good can't be reached here; onRunEvalFailure is tested below.
  it('stops at a case that fails', async () => {
    const { suite, ran } = fakeSuite({
      runCase: vi.fn(async (_runId: string, id: string) => {
        if (id === 'b') throw new Error('database went away');
        ran.push(id);
        return { line: id };
      }),
    });

    const { error } = await run(suite, request, passGaps('a'));

    expect(errorText(error)).toContain('database went away');
    expect(ran).toEqual(['a']);
    expect(suite.finish).not.toHaveBeenCalled();
  });

  it('gives up at once on a config that cannot start', async () => {
    const { suite } = fakeSuite({
      start: vi.fn(async () => {
        throw new Error('No config "nope"');
      }),
    });

    const { error } = await run(suite);

    expect(errorText(error)).toContain('No config "nope"');
    expect(suite.runCase).not.toHaveBeenCalled();
    expect(suite.fail).not.toHaveBeenCalled();
  });

  it('refuses an unknown suite', async () => {
    const { suite } = fakeSuite();

    const { error } = await run(suite, { ...request, suite: 'nope' });

    expect(errorText(error)).toContain('Unknown eval suite "nope"');
    expect(suite.start).not.toHaveBeenCalled();
  });
});

describe('one run at a time', () => {
  it('refuses to start while another run is going, worker or CLI', async () => {
    // A CLI run that started long ago but stored a result a minute ago is still going.
    const cli = await createRun('vector-only', minutesAgo(120));
    await prismaClient.evalResult.create({
      data: { runId: cli.id, caseId, latencyMs: 5, createdAt: minutesAgo(1) },
    });
    const { suite } = fakeSuite();

    const { error } = await run(suite);

    expect(errorText(error)).toContain(
      `Eval run ${cli.id} (retrieval vector-only) is still running`,
    );
    expect(suite.start).not.toHaveBeenCalled();
    const row = await prismaClient.evalRun.findUniqueOrThrow({ where: { id: cli.id } });
    expect(row.status).toBe('RUNNING');
  });

  it('marks a run with no progress for a long time FAILED, then starts', async () => {
    const minutes = RUN_STALE_AFTER_MS / 60_000;
    const dead = await createRun('vector-only', minutesAgo(minutes * 3));
    await prismaClient.evalResult.create({
      data: { runId: dead.id, caseId, latencyMs: 5, createdAt: minutesAgo(minutes + 1) },
    });
    const { suite } = fakeSuite();

    const { result } = await run(suite);

    expect(result).toMatchObject({ cases: 3 });
    const row = await prismaClient.evalRun.findUniqueOrThrow({ where: { id: dead.id } });
    expect(row.status).toBe('FAILED');
    expect(row.notes).toMatch(/^Stale: no progress/);
    expect(row.finishedAt).not.toBeNull();
  });

  it('lets a fresh run through when nothing is running', async () => {
    await expect(claimRunSlot()).resolves.toBeUndefined();
  });
});

describe('onRunEvalFailure', () => {
  it('marks the run that function run was driving FAILED and leaves the others', async () => {
    const mine = await createRun('hybrid');
    const other = await createRun('vector-only');
    await tagWorkerRun(mine.id, 'fn-run-1');

    await onRunEvalFailure({
      event: { data: { run_id: 'fn-run-1' } },
      error: new Error('worker died'),
    });

    const rows = await prismaClient.evalRun.findMany({ orderBy: { name: 'asc' } });
    expect(rows.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'hybrid', status: 'FAILED' },
      { name: 'vector-only', status: 'RUNNING' },
    ]);
    expect(rows[0]!.notes).toBe('The eval worker failed: worker died');
    expect(other.status).toBe('RUNNING');
  });

  it('leaves a run that already ended alone', async () => {
    const done = await createRun('hybrid');
    await tagWorkerRun(done.id, 'fn-run-2');
    await prismaClient.evalRun.update({ where: { id: done.id }, data: { status: 'DONE' } });

    await onRunEvalFailure({ event: { data: { run_id: 'fn-run-2' } }, error: new Error('late') });

    const row = await prismaClient.evalRun.findUniqueOrThrow({ where: { id: done.id } });
    expect(row.status).toBe('DONE');
  });
});
