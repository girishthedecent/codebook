import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import type { Source } from '../src/generated/prisma/client.js';
import {
  createPdfSourceService,
  createSourceService,
  resyncSourceService,
} from '../src/modules/sources/source.service.js';
import { ConflictError } from '../src/utils/errors/app.error.js';
import { getObjectBuffer } from '../src/utils/storage.js';
import {
  bookPath,
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
  type CorpusSource,
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

const POLL_MS = 5_000;
const TIMEOUT_MS = 60 * 60 * 1000;

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
  await checkServices();

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
      const source = await createSource(user.id, workspace.id, entry);
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

/** Both servers must be up: the API runs the ingest steps Inngest calls. */
async function checkServices() {
  if (!serverConfig.INNGEST_DEV) {
    fail('evals:corpus runs against the local dev setup (INNGEST_DEV=1)');
  }
  const api = new URL('/api/v1/health/ready', serverConfig.APP_URL).href;
  const inngest = serverConfig.INNGEST_BASE_URL ?? 'http://localhost:8288';
  if (!(await reachable(api))) fail(`The dev server isn't answering at ${api}: run pnpm dev`);
  if (!(await reachable(inngest))) {
    fail(`The Inngest dev server isn't answering at ${inngest}: run docker compose up -d`);
  }
}

async function reachable(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function createSource(userId: string, workspaceId: string, entry: CorpusSource) {
  try {
    switch (entry.type) {
      case 'PDF': {
        const path = await bookFile(entry, userId);
        const { size } = await stat(path);
        return await createPdfSourceService(
          userId,
          workspaceId,
          { path, originalName: entry.location.file, size },
          { title: entry.title },
        );
      }
      case 'GITHUB_REPO':
        return await createSourceService(userId, workspaceId, {
          type: entry.type,
          ...entry.location,
        });
      case 'WEBSITE':
        return await createSourceService(userId, workspaceId, {
          type: entry.type,
          ...entry.location,
        });
    }
  } catch (error) {
    if (error instanceof ConflictError) {
      fail(`${entry.sourceKey}: ${error.message} (another run of this script?)`);
    }
    throw error;
  }
}

/**
 * The book's file in evals/corpus/. When it isn't there yet, it is copied from storage, from
 * the copy uploaded as a normal source; the folder is gitignored.
 */
async function bookFile(entry: Extract<CorpusSource, { type: 'PDF' }>, evalUserId: string) {
  const path = bookPath(entry);
  if (existsSync(path)) return path;

  // No local file to hash: an upload of the same file name or title.
  const uploads = await prismaClient.source.findMany({
    where: { type: 'PDF', workspace: { userId: { not: evalUserId } } },
    select: { type: true, title: true, origin: true },
  });
  const upload = uploads.find((row) => isSpecSource(entry, row));
  const storageKey = (upload?.origin as { storageKey?: string | null } | undefined)?.storageKey;
  const file = storageKey ? await getObjectBuffer(storageKey) : null;
  if (!file) fail(`Put the book at evals/corpus/${entry.location.file}`);

  await writeFile(path, file);
  console.log(`Copied ${entry.location.file} from storage into evals/corpus/`);
  return path;
}

/** Fails once the eval user's ingest has tried a model or embedding call since `since`. */
async function assertNoModelCalls(userId: string, since: Date) {
  const calls = await prismaClient.usageEvent.groupBy({
    by: ['task'],
    where: { userId, type: { in: ['LLM', 'EMBEDDING'] }, createdAt: { gte: since } },
    _count: true,
  });
  if (calls.length === 0) return;
  const list = calls.map((row) => `${row._count} ${row.task}`).join(', ');
  fail(
    `The ingest called a model (${list}) although --require-cached was given: the cache ` +
      'file is out of date. Export it again where the corpus is built and commit it.',
  );
}

async function waitForSources(sourceIds: Record<string, string>, check?: () => Promise<void>) {
  const started = Date.now();
  let last = '';
  for (;;) {
    const rows = await prismaClient.source.findMany({
      where: { id: { in: Object.values(sourceIds) } },
    });
    const byKey: Record<string, Source> = {};
    for (const [key, id] of Object.entries(sourceIds)) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) fail(`${key} was deleted while ingesting`);
      byKey[key] = row;
    }

    const line = Object.entries(byKey)
      .map(([key, row]) =>
        row.status === 'PROCESSING'
          ? `${key} ${row.stage} ${row.progress}%`
          : `${key} ${row.status}`,
      )
      .join(' · ');
    if (line !== last) {
      console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
      last = line;
    }

    // After reading the statuses, so a call made just before the last one isn't missed.
    await check?.();
    const rowsNow = Object.values(byKey);
    if (rowsNow.every((row) => row.status === 'READY' || row.status === 'FAILED')) return byKey;
    if (Date.now() - started > TIMEOUT_MS) fail('Still ingesting after an hour; check Inngest');
    await sleep(POLL_MS);
  }
}

function fail(message: string): never {
  throw new CorpusError(message);
}

class CorpusError extends Error {}

try {
  await main();
} catch (error) {
  console.error(error instanceof CorpusError ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
