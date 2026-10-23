import { inngest } from '../../config/inngest.config.js';
import logger from '../../config/logger.config.js';
import { sourceDeleted, workspaceDeleted } from '../../inngest/events.js';
import { deletePrefix } from '../../utils/storage.js';

// Everything a workspace stores lives under its prefix, so deleting a workspace or a
// source is one prefix delete.
export function workspacePrefix(userId: string, workspaceId: string) {
  return `users/${userId}/workspaces/${workspaceId}/`;
}

export function sourcePrefix(userId: string, workspaceId: string, sourceId: string) {
  return `${workspacePrefix(userId, workspaceId)}sources/${sourceId}/`;
}

export function pdfStorageKey(userId: string, workspaceId: string, sourceId: string) {
  return `${sourcePrefix(userId, workspaceId, sourceId)}original.pdf`;
}

type CleanupEvent =
  | { kind: 'source'; sourceId: string; storagePrefix: string }
  | { kind: 'workspace'; workspaceId: string; storagePrefix: string };

/**
 * Deletes stored files after their rows are gone. Normally a background job does it (with
 * retries); if the queue is down, it's done inline so files aren't left behind. Never
 * throws: the delete the user asked for has already happened.
 */
export async function queueStorageCleanup(event: CleanupEvent) {
  try {
    await inngest.send(
      event.kind === 'source'
        ? sourceDeleted.create({ sourceId: event.sourceId, storagePrefix: event.storagePrefix })
        : workspaceDeleted.create({
            workspaceId: event.workspaceId,
            storagePrefix: event.storagePrefix,
          }),
    );
  } catch (queueError) {
    logger.warn('Could not queue storage cleanup, deleting inline', {
      error: queueError,
      prefix: event.storagePrefix,
    });
    try {
      await deletePrefix(event.storagePrefix);
    } catch (error) {
      logger.error('Storage cleanup failed; files left behind', {
        error,
        prefix: event.storagePrefix,
      });
    }
  }
}

const STORAGE_PREFIX = /^users\/[^/]+\/workspaces\/[^/]+\/(sources\/[^/]+\/)?$/;

/** Cleanup jobs only ever delete a workspace's or a source's folder, never anything wider. */
export function isCleanupPrefix(prefix: string) {
  return STORAGE_PREFIX.test(prefix);
}
