import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { importAccepted } from './candidates.js';
import { importCases, readDatasetFile } from './dataset.js';

// pnpm evals:import [--file evals/datasets/core.json] [--candidates <candidates file>]
//   With --candidates, the accepted candidates are merged in; the dataset file is rewritten
//   only once the import went through.

const CORPUS_FILE = 'evals/datasets/corpus.json';

async function main() {
  const { values } = parseArgs({
    // `pnpm evals -- --config x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      file: { type: 'string', default: 'evals/datasets/core.json' },
      candidates: { type: 'string' },
    },
  });
  const file = values.file;
  const name = basename(file, '.json');

  // Kept on the dataset as it was at import time; the corpus script validates it.
  const corpus = existsSync(CORPUS_FILE)
    ? (JSON.parse(await readFile(CORPUS_FILE, 'utf8')) as Prisma.InputJsonValue)
    : undefined;

  let result: { imported: number; missing: string[] };
  if (values.candidates) {
    if (!existsSync(values.candidates)) throw new Error(`No file ${values.candidates}`);
    const merged = await importAccepted(file, values.candidates, name, corpus);
    if (merged.accepted === 0) {
      console.log(`No accepted candidates in ${values.candidates}; set "accepted": true to import`);
      return;
    }
    console.log(`Merged ${merged.accepted} accepted candidates into ${file}`);
    result = merged;
  } else {
    result = await importCases(name, await readDatasetFile(file), corpus);
  }

  console.log(`Imported ${result.imported} cases into dataset "${name}"`);
  if (result.missing.length > 0) {
    console.log(`Retired (kept for old runs, not run again): ${result.missing.join(', ')}`);
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
