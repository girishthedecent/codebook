import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import {
  addNew,
  readCandidates,
  SYNTHETIC_FILE,
  synthesizeCandidates,
  writeJson,
  type SourceKey,
} from './candidates.js';
import { loadCorpus } from './corpusWorkspace.js';

// pnpm evals:synth -- --source book|repo|docs [--n 30] [--dataset core] [--gap-ms 12000]
// Drafts questions from random passages of the eval corpus into
// evals/datasets/synthetic-candidates.json. Review them there (fix, then set
// "accepted": true) and import with: pnpm evals:import -- --candidates <that file>

const SOURCE_KEYS = ['book', 'repo', 'docs'] as const;

async function main() {
  const { values } = parseArgs({
    // `pnpm evals:synth -- --source x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      source: { type: 'string' },
      n: { type: 'string', default: '30' },
      dataset: { type: 'string', default: 'core' },
      // gpt-oss-20b allows 8K tokens a minute; one passage and its answer take ~1.5K.
      'gap-ms': { type: 'string', default: '12000' },
    },
  });
  const sourceKey = values.source as SourceKey;
  if (!SOURCE_KEYS.includes(sourceKey)) {
    throw new Error(`--source must be one of ${SOURCE_KEYS.join(', ')}`);
  }
  const n = Number(values.n);
  const gapMs = Number(values['gap-ms']);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('--n must be 1 to 100');
  if (!Number.isInteger(gapMs) || gapMs < 0) throw new Error('--gap-ms must be a whole number');

  const corpus = await loadCorpus(values.dataset, 'context');
  const source = corpus.sources.find((entry) => entry.sourceKey === sourceKey);
  if (!source) throw new Error(`The corpus has no "${sourceKey}" source`);
  if (source.status !== 'READY') throw new Error(`The ${sourceKey} source is ${source.status}`);

  let candidates = await readCandidates(SYNTHETIC_FILE);
  const skipChunkIds = new Set(
    candidates.flatMap((candidate) =>
      typeof candidate.from.chunkId === 'string' ? [candidate.from.chunkId] : [],
    ),
  );

  const made = await synthesizeCandidates({
    userId: corpus.userId,
    workspaceId: corpus.workspaceId,
    sourceId: source.sourceId,
    sourceKey,
    n,
    gapMs,
    skipChunkIds,
    log: (line) => console.log(line),
    onCandidate: async (candidate) => {
      candidates = addNew(candidates, [candidate]).candidates;
      await writeJson(SYNTHETIC_FILE, candidates);
    },
  });
  console.log(`Drafted ${made.length} candidates into ${SYNTHETIC_FILE} for review`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
