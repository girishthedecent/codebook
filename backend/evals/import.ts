import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { importCases, readDatasetFile } from './dataset.js';

// pnpm evals:import [--file evals/datasets/core.json]

const CORPUS_FILE = 'evals/datasets/corpus.json';

async function main() {
  const { values } = parseArgs({
    // `pnpm evals -- --config x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: { file: { type: 'string', default: 'evals/datasets/core.json' } },
  });
  const file = values.file;
  const name = basename(file, '.json');
  const cases = await readDatasetFile(file);
  // Kept on the dataset as it was at import time; the corpus script validates it.
  const corpus = existsSync(CORPUS_FILE)
    ? (JSON.parse(await readFile(CORPUS_FILE, 'utf8')) as Prisma.InputJsonValue)
    : undefined;

  const { imported, missing } = await importCases(name, cases, corpus);
  console.log(`Imported ${imported} cases into dataset "${name}"`);
  if (missing.length > 0) {
    console.log(`Retired (kept for old runs, not run again): ${missing.join(', ')}`);
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
