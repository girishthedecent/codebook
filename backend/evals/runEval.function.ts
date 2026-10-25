import { Inngest, NonRetriableError } from 'inngest';
import { serverConfig } from '../src/config/index.js';
import logger from '../src/config/logger.config.js';
import { evalRunRequested } from '../src/inngest/events.js';
import { claimRunSlot, failWorkerRun, tagWorkerRun } from './runGuard.js';
import type { EvalSuite } from './suite.types.js';

// The eval worker's own Inngest app. Eval code never ships in the API build, so the API only
// sends `eval/run.requested` and this app (pnpm evals:worker) picks it up.
export const evalsInngest = new Inngest({
  id: 'codebook-evals',
  isDev: serverConfig.INNGEST_DEV,
  baseUrl: serverConfig.INNGEST_BASE_URL,
  eventKey: serverConfig.INNGEST_EVENT_KEY,
  signingKey: serverConfig.INNGEST_SIGNING_KEY,
  logger,
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * After the retries ran out, or when the run died some other way: the EvalRun it was driving
 * must not stay RUNNING (that would block every later run until it goes stale).
 */
export async function onRunEvalFailure({
  event,
  error,
}: {
  event: { data: { run_id: string } };
  error: Error;
}) {
  const failed = await failWorkerRun(event.data.run_id, `The eval worker failed: ${error.message}`);
  logger.warn('Eval run failed', {
    functionRunId: event.data.run_id,
    error: error.message,
    failed,
  });
}

/**
 * One eval run: start (validates the config and corpus, creates the EvalRun), one step per
 * case, then the summary. Cases are spaced by the config's gap with `step.sleep`, so a paused
 * run holds no worker. A case step that keeps failing ends the run as FAILED.
 */
export function createRunEval(suites: Record<string, EvalSuite>) {
  return evalsInngest.createFunction(
    {
      id: 'run-eval',
      triggers: [evalRunRequested],
      // One run at a time: runs share the free-tier quotas and the CPU, and two at once would
      // put each other's calls into their latency and cost. A concurrency limit wouldn't do:
      // a run waiting in step.sleep gives its slot up. A request that arrives while a run is
      // going shows as skipped in the Inngest dashboard; the API refuses it first (409).
      singleton: { mode: 'skip' },
      retries: 2,
      onFailure: onRunEvalFailure,
    },
    async ({ event, step, runId: functionRunId }) => {
      const { suite: name, requestedBy, ...options } = event.data;
      const suite = suites[name];
      if (!suite) throw new NonRetriableError(`Unknown eval suite "${name}"`);

      const run = await step.run('start', async () => {
        let started;
        try {
          // Also covers CLI runs, which the singleton doesn't see.
          await claimRunSlot();
          started = await suite.start(options);
        } catch (error) {
          // Another run going, a bad config name or an unbuilt corpus: a retry won't help.
          throw new NonRetriableError(message(error), { cause: error });
        }
        await tagWorkerRun(started.runId, functionRunId);
        return started;
      });
      logger.info('Eval run started', {
        runId: run.runId,
        suite: name,
        config: options.config,
        cases: run.caseIds.length,
        requestedBy,
      });

      try {
        for (const [index, caseId] of run.caseIds.entries()) {
          const { ms } = await step.run(`case-${caseId}`, async () => {
            const started = Date.now();
            await suite.runCase(run.runId, caseId);
            return { ms: Date.now() - started };
          });
          // The gap is between two cases' starts, so the case's own time counts toward it.
          const wait = run.gapMs - ms;
          if (index < run.caseIds.length - 1 && wait > 0) {
            await step.sleep(`gap-${caseId}`, wait);
          }
        }
        await step.run('finish', () => suite.finish(run.runId));
      } catch (error) {
        await step.run('fail', () => suite.fail(run.runId, message(error)));
        throw new NonRetriableError(`Eval run ${run.runId} failed: ${message(error)}`, {
          cause: error,
        });
      }
      return { runId: run.runId, cases: run.caseIds.length };
    },
  );
}
