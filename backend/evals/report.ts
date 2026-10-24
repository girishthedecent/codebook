import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { EvalSplit } from '../src/generated/prisma/enums.js';
import { latestFile, loadRuns, REPORT_DIR, writeReport } from './reportMarkdown.js';

// pnpm evals:report [--runs id,id] [--split DEV] [--dataset core] — by default the latest
// full run of each config on that split and dataset.

async function main() {
  const { values } = parseArgs({
    // `pnpm evals -- --config x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      runs: { type: 'string' },
      split: { type: 'string', default: 'DEV' },
      dataset: { type: 'string', default: 'core' },
    },
  });
  const split = values.split.toUpperCase();
  if (!(split in EvalSplit)) throw new Error(`--split must be DEV or HELDOUT`);
  const ids = values.runs
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const runs = await loadRuns(ids, { split: split as EvalSplit, dataset: values.dataset });
  const file = await writeReport(runs, REPORT_DIR, new Date(), split as EvalSplit);
  console.log(`Wrote ${file} and ${latestFile(split as EvalSplit)} (${runs.length} runs)`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
