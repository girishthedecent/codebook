import { appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { compareToBaseline, renderGateMarkdown } from './gateCompare.js';
import { BASELINE_FILE, gateRunState, readBaseline, runGateCases } from './gateRun.js';

// pnpm evals:gate [--dataset core] [--baseline evals/baseline.json] [--run <id>]
//
// Runs the gate config over the gate cases (or takes a finished gate run) and compares it
// with the committed baseline. Exits 1 when a gated metric dropped past its tolerance, or
// when the corpus or the cases no longer match the baseline. In GitHub Actions the report
// also goes to the job summary.
//
// Setting it up (or after the gate corpus or cases change), with the dev server and Inngest:
//   pnpm evals:corpus -- --variant gate     build the gate corpus (repository + docs page)
//   pnpm evals:baseline                     run the gate cases, write evals/baseline.json
//   pnpm evals:cache -- export              write evals/cache/gate-cache.jsonl.gz
// and commit both files. CI loads the cache file, so it reproduces the baseline's numbers
// without API keys.

async function main() {
  const { values } = parseArgs({
    // `pnpm evals:gate -- --run x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      dataset: { type: 'string', default: 'core' },
      baseline: { type: 'string', default: BASELINE_FILE },
      run: { type: 'string' },
    },
  });
  // Read first: a missing baseline should fail before any search runs.
  const baseline = await readBaseline(values.baseline);
  const runId = values.run ?? (await runGateCases(values.dataset, (line) => console.log(line)));
  const { fingerprint, metrics } = await gateRunState(runId);

  const result = compareToBaseline(baseline, { ...fingerprint, metrics });
  const markdown = renderGateMarkdown(result, {
    runId,
    baselineRunId: baseline.runId,
    cases: fingerprint.cases,
  });
  console.log(`\n${markdown}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (result.status !== 'pass') process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
