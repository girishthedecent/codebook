import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { appConfig } from '../../config/app.config.js';
import { inngest } from '../../config/inngest.config.js';
import logger from '../../config/logger.config.js';
import type { Prisma, Source } from '../../generated/prisma/client.js';
import { sourceIngestRequested } from '../../inngest/events.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UpstreamError,
} from '../../utils/errors/app.error.js';
import type { PaginationQuery } from '../../utils/helpers/pagination.helpers.js';
import { assertPublicUrl } from '../../utils/network.js';
import type { SseStream } from '../../utils/sse.js';
import { deleteObject, putObject } from '../../utils/storage.js';
import { assertWorkspaceAccess } from '../workspaces/workspace.service.js';
import { getRepo, refExists } from './github.client.js';
import {
  type CreateSourceInput,
  type PdfOrigin,
  type RepoOrigin,
  type UploadFields,
  type WebsiteOrigin,
  toProgress,
} from './source.dto.js';
import {
  countSourcesByStatus,
  createSource,
  deleteSource,
  findSource,
  findSourceForUser,
  listSources,
  requeueSource,
  updateSourceIfExists,
} from './source.repository.js';
import { pdfStorageKey, queueStorageCleanup, sourcePrefix } from './source.storage.js';

type NewSource = Omit<Prisma.SourceUncheckedCreateInput, 'workspaceId'>;

export type UploadedFile = {
  path: string;
  originalName: string;
  size: number;
};

// ---- reading ----------------------------------------------------------------------------

/** The source if this user may read it (demo sources included); otherwise a 404. */
export async function getSourceService(userId: string, sourceId: string) {
  const source = await findSourceForUser(userId, sourceId, { includeDemo: true });
  if (!source) throw new NotFoundError('Source not found');
  return source;
}

export async function listSourcesService(
  userId: string,
  workspaceId: string,
  page: PaginationQuery,
) {
  await assertWorkspaceAccess(userId, workspaceId, { allowDemoRead: true });
  return listSources(workspaceId, page);
}

// ---- adding -----------------------------------------------------------------------------

export async function createSourceService(
  userId: string,
  workspaceId: string,
  input: CreateSourceInput,
) {
  await assertWorkspaceAccess(userId, workspaceId);
  const data = input.type === 'GITHUB_REPO' ? await repoSource(input) : await websiteSource(input);
  const source = await insertSource(workspaceId, data);
  return queueIngest(source, 'created');
}

export async function createPdfSourceService(
  userId: string,
  workspaceId: string,
  file: UploadedFile,
  fields: UploadFields,
) {
  const workspace = await assertWorkspaceAccess(userId, workspaceId);
  await assertPdfHeader(file.path);

  const origin: PdfOrigin = {
    storageKey: null,
    fileName: file.originalName,
    size: file.size,
    mime: 'application/pdf',
  };
  const source = await insertSource(workspaceId, {
    type: 'PDF',
    title: fields.title ?? titleFromFileName(file.originalName),
    origin,
    // The same bytes uploaded twice to one workspace are a duplicate, whatever the name.
    dedupeKey: `pdf:${await sha256File(file.path)}`,
  });

  const storageKey = pdfStorageKey(workspace.userId, workspaceId, source.id);
  try {
    await putObject(storageKey, createReadStream(file.path), {
      contentType: 'application/pdf',
      contentLength: file.size,
    });
  } catch (error) {
    // No file means nothing to ingest: drop the row rather than leave a broken source.
    logger.error('PDF upload to storage failed', { error, sourceId: source.id });
    await deleteSource(source.id);
    throw new UpstreamError('Storage');
  }

  const stored = await updateSourceIfExists(source.id, { origin: { ...origin, storageKey } });
  if (!stored) {
    // Deleted (or its workspace was) while the file was uploading: the cleanup job already
    // ran on an empty folder, so the file has to go here.
    await deleteObject(storageKey).catch((error: unknown) =>
      logger.error('Could not delete orphaned upload', { error, storageKey }),
    );
    throw new ConflictError('The source was deleted while it was uploading');
  }
  return queueIngest(stored, 'created');
}

async function repoSource(input: Extract<CreateSourceInput, { type: 'GITHUB_REPO' }>) {
  const parsed = parseGithubUrl(input.url);
  // Checked before any GitHub request; the default branch comes from GitHub and is trusted.
  const requestedRef = input.ref ?? parsed.ref;
  if (requestedRef !== undefined && !isValidGitRef(requestedRef)) {
    throw new BadRequestError(`"${requestedRef}" is not a valid branch, tag or commit`);
  }

  const repo = await getRepo(parsed.owner, parsed.repo);
  if (!repo) throw new BadRequestError('Repository not found. Only public repositories work.');
  if (repo.isPrivate) throw new BadRequestError('Only public repositories are supported');

  const { maxRepoSizeMb } = appConfig.sources;
  if (repo.sizeKb > maxRepoSizeMb * 1024) {
    throw new BadRequestError(`Repository is larger than ${maxRepoSizeMb} MB`);
  }

  const ref = requestedRef ?? repo.defaultBranch;
  if (ref !== repo.defaultBranch && !(await refExists(parsed.owner, parsed.repo, ref))) {
    throw new BadRequestError(`Branch, tag or commit "${ref}" not found`);
  }

  // The commit is resolved when ingestion runs, so a queued or resynced source gets the
  // branch as it is then.
  const [owner, name] = repo.fullName.split('/') as [string, string];
  const origin: RepoOrigin = { owner, repo: name, ref, defaultBranch: repo.defaultBranch };
  return {
    type: 'GITHUB_REPO',
    title: ref === repo.defaultBranch ? repo.fullName : `${repo.fullName}@${ref}`,
    origin,
    // Owner and repo names are case-insensitive on GitHub; refs are not.
    dedupeKey: `github:${repo.fullName.toLowerCase()}@${ref}`,
  } satisfies NewSource;
}

async function websiteSource(input: Extract<CreateSourceInput, { type: 'WEBSITE' }>) {
  const url = await assertPublicUrl(input.url);
  url.hash = '';
  const origin: WebsiteOrigin = {
    url: url.href,
    maxDepth: input.maxDepth,
    maxPages: input.maxPages,
  };
  return {
    type: 'WEBSITE',
    // Replaced by the page's <title> when it's fetched (Phase 8).
    title: `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`,
    origin,
    dedupeKey: `web:${url.href}`,
  } satisfies NewSource;
}

async function insertSource(workspaceId: string, data: NewSource) {
  const { maxPerWorkspace } = appConfig.sources;
  const result = await createSource(workspaceId, data, maxPerWorkspace);
  if (result.ok) return result.source;
  if (result.reason === 'no-workspace') throw new NotFoundError('Workspace not found');
  throw new ConflictError(
    result.reason === 'limit'
      ? `A workspace can have up to ${maxPerWorkspace} sources. Delete one to add another.`
      : 'This source is already in the workspace',
  );
}

/**
 * Sends the ingest event. If the queue is down the source is marked FAILED with a message
 * the user can act on (resync), instead of sitting in PENDING forever.
 */
async function queueIngest(source: Source, reason: 'created' | 'resync') {
  try {
    await inngest.send(sourceIngestRequested.create({ sourceId: source.id, reason }));
    return source;
  } catch (error) {
    logger.error('Could not queue ingestion', { error, sourceId: source.id });
    const failed = await updateSourceIfExists(source.id, {
      status: 'FAILED',
      error: 'Could not queue the source for processing. Try a resync.',
    });
    return failed ?? source;
  }
}

// ---- changing ---------------------------------------------------------------------------

export async function deleteSourceService(userId: string, sourceId: string) {
  const source = await findSourceForUser(userId, sourceId);
  if (!source || !(await deleteSource(sourceId))) throw new NotFoundError('Source not found');

  await queueStorageCleanup({
    kind: 'source',
    sourceId,
    storagePrefix: sourcePrefix(source.workspace.userId, source.workspaceId, sourceId),
  });
}

export async function resyncSourceService(userId: string, sourceId: string) {
  const found = await findSourceForUser(userId, sourceId);
  if (!found) throw new NotFoundError('Source not found');

  // A PDF whose upload never finished has nothing to ingest; resyncing can't fix that.
  if (found.type === 'PDF' && !(found.origin as PdfOrigin).storageKey) {
    await updateSourceIfExists(sourceId, {
      status: 'FAILED',
      error: 'The upload did not finish. Delete this source and upload the file again.',
    });
    throw new ConflictError('The upload did not finish. Delete this source and upload it again.');
  }

  const now = Date.now();
  const stale = {
    pendingBefore: new Date(now - appConfig.sources.stalePendingMs),
    processingBefore: new Date(now - appConfig.sources.staleProcessingMs),
  };
  if (!(await requeueSource(sourceId, stale))) {
    throw new ConflictError('This source is already queued or being processed');
  }
  const source = await findSource(sourceId);
  if (!source) throw new NotFoundError('Source not found');
  return queueIngest(source, 'resync');
}

/** Source counts by status, for the workspace view. */
export async function countSourcesService(workspaceId: string) {
  return countSourcesByStatus(workspaceId);
}

// ---- progress ---------------------------------------------------------------------------

/**
 * Sends the source's state now and whenever it changes, then `done` / `failed` and closes.
 * Polls the row: simple, and one query a second per open stream is cheap. Postgres
 * LISTEN/NOTIFY can replace it if many streams are open at once.
 */
export function watchSourceProgress(sourceId: string, stream: SseStream) {
  let last: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  stream.onClose(() => clearTimeout(timer));

  const tick = async () => {
    const source = await findSource(sourceId);
    if (stream.closed) return;
    if (!source) {
      stream.send('deleted', {});
      return stream.close();
    }

    const progress = toProgress(source);
    const snapshot = JSON.stringify(progress);
    if (snapshot !== last) {
      last = snapshot;
      stream.send('progress', progress);
    }
    if (source.status === 'READY' || source.status === 'FAILED') {
      stream.send(source.status === 'READY' ? 'done' : 'failed', progress);
      return stream.close();
    }
    timer = setTimeout(run, appConfig.sources.progressPollMs);
  };

  const run = () => {
    tick().catch((error: unknown) => {
      logger.error('Progress stream failed', { error, sourceId });
      stream.send('error', { message: 'Progress is unavailable right now' });
      stream.close();
    });
  };
  run();
}

// ---- helpers ----------------------------------------------------------------------------

const GITHUB_URL = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/(.+?))?\/?$/;

/** owner, repo and optional ref from https://github.com/{owner}/{repo}(/tree/{ref}). */
export function parseGithubUrl(raw: string) {
  const url = new URL(raw);
  const match = GITHUB_URL.exec(url.pathname);
  if (!['github.com', 'www.github.com'].includes(url.hostname) || !match) {
    throw new BadRequestError('Expected a URL like https://github.com/owner/repo');
  }
  let ref: string | undefined;
  try {
    ref = match[3] === undefined ? undefined : decodeURIComponent(match[3]);
  } catch {
    throw new BadRequestError('The branch in the URL is not valid');
  }
  return { owner: match[1]!, repo: match[2]!, ref };
}

/**
 * Git's own rules for ref names (git check-ref-format), so a name like "." or "a..b" is
 * refused here instead of reaching the GitHub API as a different path.
 */
export function isValidGitRef(ref: string) {
  // Control characters and space.
  const hasControl = [...ref].some((char) => char.charCodeAt(0) <= 0x20 || char === '\u007f');
  return (
    ref.length > 0 &&
    ref !== '@' &&
    !hasControl &&
    !/[~^:?*[\\]/.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    !ref.includes('@{') &&
    // No part may start with a dot or end in .lock; no leading/trailing slash or dot.
    !/^[./]|[./]$|\.lock(\/|$)|\/\./.test(ref)
  );
}

// The PDF spec allows a few bytes before the header, but not more than 1 KB.
async function assertPdfHeader(path: string) {
  const file = await open(path);
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(1024), 0, 1024, 0);
    if (!buffer.subarray(0, bytesRead).includes('%PDF-')) {
      throw new BadRequestError('The file is not a valid PDF');
    }
  } finally {
    await file.close();
  }
}

async function sha256File(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function titleFromFileName(fileName: string) {
  const title = fileName.replace(/\.pdf$/i, '').trim();
  return title.slice(0, 200) || 'Untitled PDF';
}
