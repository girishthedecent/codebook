import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { resyncSourceService } from '../src/modules/sources/source.service.js';
import {
  assertNoModelCalls,
  checkServices,
  createCorpusSource,
  CorpusError,
  fail,
  waitForSources,
} from './corpusIngest.js';
import {
  CORPUS_VARIANTS,
  corpusVersion,
  ensureEvalUser,
  ensureEvalWorkspace,
  estimateEmbeddings,
  findTwin,
  isSpecSource,
  loadCorpusSpec,
  localPdfKey,
  sourcesFor,
  type CorpusVariant,
} from './corpusWorkspace.js';

// pnpm evals:corpus [--dataset core] [--variant context|nocontext|gate] [--no-context]
//   [--max-embeddings 300] [--skip-budget] [--require-cached]
//
// Builds the eval workspace for a dataset through the real pipeline: creates the sources the
// way the API does, which queues their ingest runs, and waits until each is READY or FAILED.
// Needs the dev server and the Inngest dev server running. A rerun only adds what is missing
// and resyncs failed sources. --require-cached (CI, after loading the committed cache file)
// fails as soon as the ingest makes any model or embedding call: everything must come from
// the caches, so a stale cache file shows up as an error, never as quota spent.

async function main() {
  const { values } = parseArgs({
    // `pnpm evals:corpus -- --variant gate` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      dataset: { type: 'string', default: 'core' },
      variant: { type: 'string' },
      // Same as --variant nocontext.
      'no-context': { type: 'boolean', default: false },
      'max-embeddings': { type: 'string', default: '300' },
      'skip-budget': { type: 'boolean', default: false },
      'require-cached': { type: 'boolean', default: false },
    },
  });
  const dataset = values.dataset;
  const variant = (values.variant ??
    (values['no-context'] ? 'nocontext' : 'context')) as CorpusVariant;
  if (!CORPUS_VARIANTS.includes(variant)) {
    throw new Error(`--variant must be one of ${CORPUS_VARIANTS.join(', ')}`);
  }
  const maxEmbeddings = Number(values['max-embeddings']);
  if (!Number.isInteger(maxEmbeddings) || maxEmbeddings < 0) {
    throw new Error('--max-embeddings must be a whole number');
  }

  const spec = loadCorpusSpec(dataset);
  await checkServices('evals:corpus');

  const user = await ensureEvalUser();
  const workspace = await ensureEvalWorkspace(user.id, dataset, variant);
  console.log(
    `Workspace ${workspace.name} (${workspace.id}), corpus ${corpusVersion(spec, variant)}`,
  );

  const existing = await prismaClient.source.findMany({ where: { workspaceId: workspace.id } });
  const plan = [];
  for (const entry of sourcesFor(spec, variant)) {
    const pdfKey = await localPdfKey(entry);
    plan.push({ entry, row: existing.find((row) => isSpecSource(entry, row, pdfKey)) ?? null });
  }
  const toIngest = plan.filter(({ row }) => !row || row.status === 'FAILED');

  // Each new ingest's likely embedding count, from an indexed copy outside the eval workspaces.
  let estimate = 0;
  const unknown: string[] = [];
  for (const { entry } of toIngest) {
    const count = estimateEmbeddings(entry, variant, await findTwin(entry, user.id));
    if (count === null) unknown.push(entry.sourceKey);
    else estimate += count;
  }
  if (toIngest.length > 0) {
    const keys = toIngest.map(({ entry }) => entry.sourceKey).join(', ');
    console.log(`To ingest: ${keys}; about ${estimate} new embeddings`);
  }
  // The estimate needs an indexed copy elsewhere (there is none in CI); --require-cached
  // checks what the ingest really does instead.
  if (!values['skip-budget'] && !values['require-cached']) {
    if (unknown.length > 0) {
      fail(
        `No indexed copy of ${unknown.join(', ')} to estimate its embeddings from. ` +
          'Add it once as a normal source, or pass --skip-budget.',
      );
    }
    if (estimate > maxEmbeddings) {
      fail(`About ${estimate} new embeddings is over --max-embeddings ${maxEmbeddings}`);
    }
  }

  const started = new Date();
  const sourceIds: Record<string, string> = {};
  for (const { entry, row } of plan) {
    if (!row) {
      const source = await createCorpusSource(user.id, workspace.id, entry);
      console.log(`${entry.sourceKey}: created "${source.title}"`);
      sourceIds[entry.sourceKey] = source.id;
    } else {
      if (row.status === 'FAILED') {
        await resyncSourceService(user.id, row.id);
        console.log(`${entry.sourceKey}: failed before (${row.error ?? 'no message'}), resyncing`);
      }
      sourceIds[entry.sourceKey] = row.id;
    }
  }

  const finished = await waitForSources(
    sourceIds,
    values['require-cached'] ? () => assertNoModelCalls(user.id, started) : undefined,
  );
  let ok = true;
  for (const [key, source] of Object.entries(finished)) {
    const entry = spec.sources.find((candidate) => candidate.sourceKey === key)!;
    if (source.status !== 'READY') {
      ok = false;
      console.log(`${key}: ${source.status} ${source.error ?? ''}`);
    } else if (source.title !== entry.title) {
      // Searches still work; only the embedding cache missed.
      console.log(`${key}: READY, but titled "${source.title}" instead of "${entry.title}"`);
    } else {
      console.log(`${key}: READY`);
    }
  }
  if (!ok) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof CorpusError ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
