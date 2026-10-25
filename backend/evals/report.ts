import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { EvalSplit } from '../src/generated/prisma/enums.js';
import { latestAnswerFile, loadAnswerRuns, writeAnswerReport } from './answerReport.js';
import { latestFile, loadRuns, REPORT_DIR, writeReport } from './reportMarkdown.js';

// pnpm evals:report [--suite retrieval|answer] [--runs id,id] [--split DEV] [--dataset core]
//   [--corpus context] — by default the latest run of each config on that split and dataset
// (for retrieval, the latest full run; for answers, on one corpus and with one judge).

async function main() {
  const { values } = parseArgs({
    // `pnpm evals -- --config x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      suite: { type: 'string', default: 'retrieval' },
      corpus: { type: 'string', default: 'context' },
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
  const filter = { split: split as EvalSplit, dataset: values.dataset };

  if (values.suite === 'answer') {
    const runs = await loadAnswerRuns(ids, { ...filter, corpus: values.corpus });
    const file = await writeAnswerReport(runs, REPORT_DIR, new Date(), split as EvalSplit);
    console.log(`Wrote ${file} and ${latestAnswerFile(split as EvalSplit)} (${runs.length} runs)`);
    return;
  }
  if (values.suite !== 'retrieval') throw new Error('--suite must be retrieval or answer');

  const runs = await loadRuns(ids, filter);
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
