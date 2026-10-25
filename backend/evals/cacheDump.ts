import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { corpusCacheKeys, exportCache, GATE_CACHE_FILE, importCache } from './cacheFile.js';
import {
  CORPUS_VARIANTS,
  corpusVersion,
  loadCorpusSpec,
  type CorpusVariant,
} from './corpusWorkspace.js';
import { GATE_TAGS } from './gateRun.js';

// pnpm evals:cache -- export [--dataset core] [--from gate|context]
//   [--file evals/cache/gate-cache.jsonl.gz]
// pnpm evals:cache -- import [--file …]
// pnpm evals:cache -- version [--dataset core]   (the gate corpus version)
//
// Export writes the cached embeddings and contexts the gate corpus and the gate questions
// need, into a file that is committed; import (in CI, before the corpus build) loads them, so
// the ingest and the gate find everything cached. Export again, and commit the file, whenever
// the gate corpus or the gate questions change.

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    allowPositionals: true,
    options: {
      dataset: { type: 'string', default: 'core' },
      file: { type: 'string', default: GATE_CACHE_FILE },
      // The workspace to read the gate sources' chunks from: `context` indexes them the same
      // way, so the file can be written before the gate corpus exists.
      from: { type: 'string', default: 'gate' },
    },
  });
  const [command] = positionals;

  if (command === 'export') {
    const from = values.from as CorpusVariant;
    if (!CORPUS_VARIANTS.includes(from)) {
      throw new Error(`--from must be one of ${CORPUS_VARIANTS.join(', ')}`);
    }
    const keys = await corpusCacheKeys(values.dataset, 'gate', GATE_TAGS, from);
    const written = await exportCache(values.file, keys);
    const { size } = await stat(values.file);
    console.log(
      `Wrote ${values.file} (${Math.round(size / 1024)} KB): ${written.embeddings} embeddings ` +
        `(${keys.chunks} chunks, ${keys.questions} questions), ${written.contexts} contexts`,
    );
  } else if (command === 'version') {
    console.log(corpusVersion(loadCorpusSpec(values.dataset), 'gate'));
  } else if (command === 'import') {
    if (!existsSync(values.file)) throw new Error(`No ${values.file}`);
    const read = await importCache(values.file);
    console.log(`Loaded ${read.embeddings} embeddings and ${read.contexts} contexts`);
  } else {
    throw new Error('Usage: pnpm evals:cache -- export|import|version [--file path]');
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
