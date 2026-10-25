import prismaClient from '../src/config/db.config.js';
import { isStale, RUN_STALE_AFTER_MS, runningRuns } from '../src/modules/evals/evals.repository.js';

// One eval run at a time, worker or CLI: runs share the free-tier quotas and the CPU, and two
// at once would put each other's calls into their latency and cost.

/**
 * Called before a worker run starts. Runs left RUNNING with no progress for a long time
 * (their worker or CLI stopped without marking them) are marked FAILED; a run still going
 * makes this throw.
 */
export async function claimRunSlot(now = new Date()) {
  const running = await runningRuns();
  const stale = running.filter((run) => isStale(run, now));
  if (stale.length > 0) {
    await prismaClient.evalRun.updateMany({
      where: { id: { in: stale.map((run) => run.id) }, status: 'RUNNING' },
      data: {
        status: 'FAILED',
        finishedAt: now,
        notes: `Stale: no progress for ${RUN_STALE_AFTER_MS / 60_000} minutes, so whatever ran it stopped`,
      },
    });
  }
  const active = running.find((run) => !isStale(run, now));
  if (active) {
    throw new Error(`Eval run ${active.id} (${active.suite} ${active.name}) is still running`);
  }
}

// The worker's function run id on the EvalRun, so its failure handler finds the run even when
// the failure came before the run id reached the handler's state.
const marker = (functionRunId: string) => `Worker run ${functionRunId}`;

export async function tagWorkerRun(runId: string, functionRunId: string) {
  await prismaClient.evalRun.update({
    where: { id: runId },
    data: { notes: marker(functionRunId) },
  });
}

/** Marks the run a worker function run was driving FAILED, if it is still RUNNING. */
export async function failWorkerRun(functionRunId: string, message: string) {
  const { count } = await prismaClient.evalRun.updateMany({
    where: { status: 'RUNNING', notes: marker(functionRunId) },
    data: { status: 'FAILED', finishedAt: new Date(), notes: message },
  });
  return count;
}
