import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { BASELINE_FILE, runGateCases, writeBaseline } from './gateRun.js';

// pnpm evals:baseline [--dataset core] [--run <id>]
//
// Writes evals/baseline.json from a fresh gate run (or a finished one). Done on purpose, when
// a change is meant to move the numbers or the corpus changed; the new file goes through
// review with that change.

async function main() {
  const { values } = parseArgs({
    // `pnpm evals:baseline -- --run x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      dataset: { type: 'string', default: 'core' },
      run: { type: 'string' },
    },
  });
  const runId = values.run ?? (await runGateCases(values.dataset, (line) => console.log(line)));
  const baseline = await writeBaseline(runId);
  const { recall5, recall10, mrr, errors } = baseline.metrics;
  console.log(
    `Wrote ${BASELINE_FILE} from run ${runId} (${baseline.cases} cases): ` +
      `recall@5 ${recall5?.toFixed(3)}, recall@10 ${recall10?.toFixed(3)}, ` +
      `MRR ${mrr?.toFixed(3)}, errors ${errors}`,
  );
  if (baseline.gitSha.includes('-dirty-')) {
    console.log('The run was on uncommitted code: rerun after committing if that matters.');
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
