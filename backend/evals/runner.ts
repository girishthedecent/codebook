import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { EvalSplit } from '../src/generated/prisma/enums.js';
import { configNames, loadConfig } from './config.js';
import { runRetrieval, SUITE } from './retrievalSuite.js';

// pnpm evals -- --suite retrieval --config hybrid-rerank [--split DEV] [--limit 20]
//   [--tags auth,flow] [--matrix a,b,c | --matrix all] [--resume <runId>] [--dataset core]

const list = (value: string | undefined) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

async function main() {
  const { values } = parseArgs({
    // `pnpm evals -- --config x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      suite: { type: 'string', default: SUITE },
      config: { type: 'string' },
      matrix: { type: 'string' },
      split: { type: 'string', default: 'DEV' },
      limit: { type: 'string' },
      tags: { type: 'string' },
      resume: { type: 'string' },
      dataset: { type: 'string', default: 'core' },
    },
  });

  if (values.suite !== SUITE) throw new Error(`Unknown suite "${values.suite}" (only ${SUITE})`);
  const split = values.split.toUpperCase();
  if (!(split in EvalSplit)) throw new Error(`--split must be DEV or HELDOUT`);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive whole number');
  }

  const names =
    values.matrix === 'all' ? await configNames() : (list(values.matrix) ?? list(values.config));
  if (!names?.length) throw new Error('Pass --config <name> or --matrix a,b,c');
  if (values.resume && names.length > 1) throw new Error('--resume takes a single --config');
  // Fail on a bad name before spending any quota.
  const configs = await Promise.all(names.map((name) => loadConfig(name)));

  for (const config of configs) {
    const { runId, summary } = await runRetrieval({
      dataset: values.dataset,
      config,
      split: split as EvalSplit,
      limit,
      tags: list(values.tags),
      resume: values.resume,
      log: (line) => console.log(line),
    });
    const { overall } = summary;
    console.log(
      `${config.name} (${runId}): recall@5 ${overall.recall5.toFixed(3)}, ` +
        `recall@10 ${overall.recall10.toFixed(3)}, MRR ${overall.mrr.toFixed(3)}, ` +
        `errors ${overall.errors}, tainted ${summary.taintedCases}`,
    );
  }
  console.log('Write the report with: pnpm evals:report');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
