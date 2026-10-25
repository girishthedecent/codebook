import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import prismaClient from '../src/config/db.config.js';
import type { SourceStatus, SourceType } from '../src/generated/prisma/enums.js';
import { ensureDemoOwner, ensureDemoWorkspace } from '../src/modules/demo/demo.service.js';
import { resyncSourceService } from '../src/modules/sources/source.service.js';
import {
  assertNoModelCalls,
  checkServices,
  createCorpusSource,
  CorpusError,
  waitForSources,
} from '../evals/corpusIngest.js';
import {
  findTwin,
  isSpecSource,
  loadCorpusSpec,
  localPdfKey,
  type CorpusSource,
  type SourceKey,
} from '../evals/corpusWorkspace.js';

// pnpm db:seed -- --demo [--allow-model-calls]
//
// Builds the public demo workspace: a system user owns it, and its sources are entries of the
// eval corpus (evals/datasets/corpus.json), picked by prisma/demo.json. They go through the
// real pipeline, so the API and the Inngest dev server must be running. Their titles are the
// corpus titles, so every context and embedding comes from the caches the eval corpus filled
// (or the committed gate cache, loaded with pnpm evals:cache): the seed stops as soon as the
// ingest calls a model, unless --allow-model-calls is given. A rerun only adds what is
// missing and resyncs failed sources. The book is optional: without an indexed copy to take
// its caches from, the demo starts with the repository and the docs page.

const demoSpecSchema = z.object({
  dataset: z.string(),
  description: z.string().trim().min(1).max(2_000),
  sources: z
    .array(
      z.object({
        sourceKey: z.enum(['book', 'repo', 'docs']),
        optional: z.boolean().default(false),
      }),
    )
    .min(1),
});

export type DemoSpec = z.infer<typeof demoSpecSchema>;

export function loadDemoSpec(): DemoSpec {
  const file = new URL('./demo.json', import.meta.url);
  return demoSpecSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

type ExistingSource = {
  id: string;
  type: SourceType;
  title: string;
  origin: unknown;
  dedupeKey: string;
  status: SourceStatus;
};

export type PlannedSource = {
  entry: CorpusSource;
  action: 'keep' | 'resync' | 'create' | 'skip';
  sourceId?: string;
};

/**
 * What a run does with each demo source: a source already in the workspace is kept (or
 * resynced when it failed); a missing one is created, unless it is optional and nothing
 * indexed it before, so its ingest couldn't come from the caches.
 */
export function planDemoSources(
  entries: { entry: CorpusSource; optional: boolean }[],
  existing: ExistingSource[],
  found: { pdfKeys: Partial<Record<SourceKey, string>>; cached: Set<SourceKey> },
  allowModelCalls: boolean,
): PlannedSource[] {
  return entries.map(({ entry, optional }) => {
    const pdfKey = found.pdfKeys[entry.sourceKey];
    const row = existing.find((candidate) => isSpecSource(entry, candidate, pdfKey));
    if (row)
      return { entry, action: row.status === 'FAILED' ? 'resync' : 'keep', sourceId: row.id };
    if (optional && !allowModelCalls && !found.cached.has(entry.sourceKey)) {
      return { entry, action: 'skip' };
    }
    return { entry, action: 'create' };
  });
}

async function seedDemo(allowModelCalls: boolean) {
  const demo = loadDemoSpec();
  const corpus = loadCorpusSpec(demo.dataset);
  const entries = demo.sources.map(({ sourceKey, optional }) => {
    const entry = corpus.sources.find((source) => source.sourceKey === sourceKey);
    if (!entry) throw new CorpusError(`demo.json names "${sourceKey}", not in the corpus spec`);
    return { entry, optional };
  });
  await checkServices('db:seed');

  const owner = await ensureDemoOwner();
  const workspace = await ensureDemoWorkspace(owner.id, demo.description);
  console.log(`Demo workspace ${workspace.name} (${workspace.id})`);

  const pdfKeys: Partial<Record<SourceKey, string>> = {};
  const cached = new Set<SourceKey>();
  for (const { entry } of entries) {
    pdfKeys[entry.sourceKey] = await localPdfKey(entry);
    // An indexed copy under the same title left its contexts and embeddings in the caches.
    if ((await findTwin(entry, owner.id))?.title === entry.title) cached.add(entry.sourceKey);
  }
  const existing = await prismaClient.source.findMany({ where: { workspaceId: workspace.id } });
  const plan = planDemoSources(entries, existing, { pdfKeys, cached }, allowModelCalls);

  const started = new Date();
  const sourceIds: Record<string, string> = {};
  for (const { entry, action, sourceId } of plan) {
    if (action === 'skip') {
      console.log(
        `${entry.sourceKey}: skipped, no indexed copy of "${entry.title}" to reuse (index it ` +
          'once, e.g. with pnpm evals:corpus, or pass --allow-model-calls)',
      );
    } else if (action === 'create') {
      const source = await createCorpusSource(owner.id, workspace.id, entry);
      console.log(`${entry.sourceKey}: created "${source.title}"`);
      sourceIds[entry.sourceKey] = source.id;
    } else {
      if (action === 'resync') {
        await resyncSourceService(owner.id, sourceId!);
        console.log(`${entry.sourceKey}: failed before, resyncing`);
      }
      sourceIds[entry.sourceKey] = sourceId!;
    }
  }

  const finished = await waitForSources(
    sourceIds,
    allowModelCalls ? undefined : () => assertNoModelCalls(owner.id, started),
  );
  let ok = true;
  for (const [key, source] of Object.entries(finished)) {
    if (source.status !== 'READY') ok = false;
    console.log(`${key}: ${source.status}${source.error ? ` ${source.error}` : ''}`);
  }
  if (!ok) process.exitCode = 1;
}

async function main() {
  const { values } = parseArgs({
    // `pnpm db:seed -- --demo` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      demo: { type: 'boolean', default: false },
      'allow-model-calls': { type: 'boolean', default: false },
    },
  });
  if (!values.demo) {
    throw new CorpusError('Nothing to seed: pass --demo to build the demo workspace');
  }
  await seedDemo(values['allow-model-calls']);
}

// Run as a script; the tests import planDemoSources.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof CorpusError ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prismaClient.$disconnect();
  }
}
