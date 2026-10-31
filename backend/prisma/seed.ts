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
  corpusSpecSchema,
  localPdfKey,
  type CorpusSource,
  type SourceKey,
} from '../evals/corpusWorkspace.js';

// pnpm db:seed -- --demo [--allow-model-calls] [--remote]
//
// Builds the public demo workspace: a system user owns it, and prisma/demo.json lists its
// sources (a book as a PDF in evals/corpus/, a repository at a commit, a docs page). They go
// through the real pipeline, so the API and Inngest must be up: the dev server and
// `pnpm dev` locally, or with --remote a deployed API (APP_URL its public address) and
// Inngest Cloud. A source that has an indexed copy elsewhere under the same title takes its
// contexts and embeddings from the caches; any other needs model calls, and the seed stops as
// soon as an ingest makes one unless --allow-model-calls is given. A rerun only adds what is
// missing and resyncs failed sources. A source marked `optional` is left out when nothing
// indexed it before.

// The sources are validated like the eval corpus's (same shape); `optional` is the demo's own.
const demoFileSchema = z.object({
  description: z.string().trim().min(1).max(2_000),
  sources: z.array(z.looseObject({ optional: z.boolean().default(false) })).min(1),
});

export type DemoSpec = {
  description: string;
  sources: { entry: CorpusSource; optional: boolean }[];
};

export function loadDemoSpec(): DemoSpec {
  const file = new URL('./demo.json', import.meta.url);
  const raw = demoFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const { sources } = corpusSpecSchema.parse({ dataset: 'demo', sources: raw.sources });
  return {
    description: raw.description,
    sources: sources.map((entry, i) => ({ entry, optional: raw.sources[i]!.optional })),
  };
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

async function seedDemo(allowModelCalls: boolean, remote: boolean) {
  const demo = loadDemoSpec();
  const entries = demo.sources;
  await checkServices('db:seed', { remote });

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
      remote: { type: 'boolean', default: false },
    },
  });
  if (!values.demo) {
    throw new CorpusError('Nothing to seed: pass --demo to build the demo workspace');
  }
  await seedDemo(values['allow-model-calls'], values.remote);
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
