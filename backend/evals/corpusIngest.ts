import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import type { Source } from '../src/generated/prisma/client.js';
import {
  createPdfSourceService,
  createSourceService,
} from '../src/modules/sources/source.service.js';
import { ConflictError } from '../src/utils/errors/app.error.js';
import { getObjectBuffer } from '../src/utils/storage.js';
import { bookPath, isSpecSource, type CorpusSource } from './corpusWorkspace.js';

// Building a corpus workspace through the real pipeline, shared by pnpm evals:corpus and the
// demo seed (pnpm db:seed -- --demo): sources are created the way the API does, which queues
// their ingest runs, and the scripts wait until each is READY or FAILED.

const POLL_MS = 5_000;
const TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Both servers must be up: the API runs the ingest steps Inngest calls. `remote` is a deployed
 * API with Inngest Cloud: APP_URL is its public address, and only the API is checked.
 */
export async function checkServices(script: string, options: { remote?: boolean } = {}) {
  const api = new URL('/api/v1/health/ready', serverConfig.APP_URL).href;
  if (options.remote) {
    if (serverConfig.INNGEST_DEV) fail(`${script} --remote needs INNGEST_DEV off (Inngest Cloud)`);
    if (!(await reachable(api))) fail(`The API isn't answering at ${api}: set APP_URL to it`);
    return;
  }
  if (!serverConfig.INNGEST_DEV) {
    fail(`${script} runs against the local dev setup (INNGEST_DEV=1)`);
  }
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

export async function createCorpusSource(userId: string, workspaceId: string, entry: CorpusSource) {
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

/** Fails once the user's ingest has tried a model or embedding call since `since`. */
export async function assertNoModelCalls(userId: string, since: Date) {
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

export async function waitForSources(
  sourceIds: Record<string, string>,
  check?: () => Promise<void>,
) {
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

export function fail(message: string): never {
  throw new CorpusError(message);
}

/** A failure the script explains itself: printed as its message, without a stack. */
export class CorpusError extends Error {}
