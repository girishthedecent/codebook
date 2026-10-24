import { Parser, type ReadEntry } from 'tar';
import { appConfig } from '../../../config/app.config.js';
import { countTokens } from '../../../utils/tokens.js';
import { pathSkipReason, readText, type SkipReason } from './file.filter.js';

/** A repository that can't be indexed as it is; the message is shown to the user. */
export class RepoArchiveError extends Error {}

export type ArchiveLimits = {
  maxDownloadBytes: number;
  maxUnpackedBytes: number;
  maxEntries: number;
  maxFileBytes: number;
  maxIndexedTokens: number;
  includeTests: boolean;
};

export type ArchiveFile = { path: string; text: string; sizeBytes: number; tokens: number };
export type SkippedPath = { path: string; reason: SkipReason; sizeBytes: number };

type Kept = ArchiveFile & { kind: 'kept' };
type Skipped = SkippedPath & { kind: 'skipped' };

const REGULAR_FILES = new Set(['File', 'OldFile', 'ContiguousFile']);
const LINKS = new Set(['SymbolicLink', 'Link']);
const MB = 1024 * 1024;

/**
 * Reads a GitHub tarball (gzipped) in memory: nothing is written to disk, so paths in the
 * archive can't reach the filesystem. Returns the files worth indexing as text and the
 * paths left out with their reason, both in path order. Throws `RepoArchiveError` when a
 * limit is hit or the archive has unsafe paths.
 */
export async function readRepoArchive(
  body: AsyncIterable<Uint8Array>,
  limits: ArchiveLimits = appConfig.ingestion.repo,
) {
  // By path; a path seen twice keeps its last entry, as extracting the archive would.
  const entries = new Map<string, Kept | Skipped>();
  let entryCount = 0;
  let unpackedBytes = 0;
  let keptTokens = 0;
  let failure: Error | undefined;

  const fail = (error: Error) => {
    failure ??= error;
  };
  const record = (entry: Kept | Skipped) => {
    const previous = entries.get(entry.path);
    if (previous?.kind === 'kept') keptTokens -= previous.tokens;
    entries.set(entry.path, entry);
    if (entry.kind === 'kept') keptTokens += entry.tokens;
    if (keptTokens > limits.maxIndexedTokens) {
      const limit = limits.maxIndexedTokens.toLocaleString('en-US');
      fail(
        new RepoArchiveError(
          `This repository has more than ${limit} tokens of text to index after filtering. ` +
            'Pick a smaller repository or branch.',
        ),
      );
    }
  };

  const onEntry = (entry: ReadEntry) => {
    if (failure) return entry.resume();
    if (entry.type !== 'Directory') entryCount++;
    unpackedBytes += entry.size;
    if (entryCount > limits.maxEntries) {
      const limit = limits.maxEntries.toLocaleString('en-US');
      fail(new RepoArchiveError(`This repository has more than ${limit} files`));
    } else if (unpackedBytes > limits.maxUnpackedBytes) {
      fail(
        new RepoArchiveError(
          `This repository unpacks to more than ${limits.maxUnpackedBytes / MB} MB`,
        ),
      );
    } else if (!isSafePath(entry.path)) {
      fail(new RepoArchiveError('The repository archive contains unsafe paths'));
    }
    const path = withoutTopFolder(entry.path);
    if (failure || entry.type === 'Directory' || !path) return entry.resume();

    const skip = (reason: SkipReason, at = path) => {
      const previous = entries.get(at);
      // A skipped directory is one row, with the size of everything under it.
      const sizeBytes =
        (previous?.kind === 'skipped' && at !== path ? previous.sizeBytes : 0) + entry.size;
      record({ kind: 'skipped', path: at, reason, sizeBytes });
      entry.resume();
    };
    const skipped = pathSkipReason(path, { includeTests: limits.includeTests });
    if (skipped) return skip(skipped.reason, skipped.dir);
    if (LINKS.has(entry.type)) return skip('link');
    if (!REGULAR_FILES.has(entry.type)) return skip('unsupported entry');
    if (entry.size > limits.maxFileBytes) return skip('too large');

    const chunks: Buffer[] = [];
    entry.on('data', (chunk: Buffer) => chunks.push(chunk));
    entry.on('end', () => {
      const result = readText(Buffer.concat(chunks), limits.maxFileBytes);
      if ('reason' in result) {
        record({ kind: 'skipped', path, reason: result.reason, sizeBytes: entry.size });
      } else {
        const tokens = countTokens(result.text);
        record({ kind: 'kept', path, text: result.text, sizeBytes: entry.size, tokens });
      }
    });
  };

  // strict: a damaged archive is an error, not a warning and a silently shorter repo.
  const parser = new Parser({ strict: true, onReadEntry: onEntry });
  const done = new Promise<void>((resolve, reject) => {
    parser.on('end', resolve);
    parser.on('error', reject);
  });
  // Fail early on a rejected parse instead of an unhandled rejection while still feeding.
  done.catch(() => undefined);

  let downloaded = 0;
  for await (const chunk of body) {
    downloaded += chunk.length;
    if (downloaded > limits.maxDownloadBytes) {
      fail(
        new RepoArchiveError(
          `The repository download is larger than ${limits.maxDownloadBytes / MB} MB`,
        ),
      );
    }
    if (failure) break;
    parser.write(Buffer.from(chunk));
  }
  if (failure) throw failure;
  parser.end();
  try {
    await done;
  } catch {
    // A complete download that tar can't read won't get better on a retry.
    throw new RepoArchiveError('The repository archive is damaged');
  }
  if (failure) throw failure;

  const sorted = [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    files: sorted
      .filter((entry): entry is Kept => entry.kind === 'kept')
      .map(({ kind: _, ...file }) => file),
    skipped: sorted
      .filter((entry): entry is Skipped => entry.kind === 'skipped')
      .map(({ kind: _, ...path }) => path),
  };
}

// GitHub never produces these; an archive that has one was tampered with.
function isSafePath(path: string) {
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || /[\\\0]/.test(path)) return false;
  return !path.split('/').includes('..');
}

// GitHub puts everything under "{owner}-{repo}-{sha7}/".
function withoutTopFolder(path: string) {
  const slash = path.indexOf('/');
  if (slash === -1) return '';
  return path.slice(slash + 1).replace(/\/$/, '');
}
