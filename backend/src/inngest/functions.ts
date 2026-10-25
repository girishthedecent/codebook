import { NonRetriableError } from 'inngest';
import { inngest } from '../config/inngest.config.js';
import { afterTurn } from '../modules/chat/afterTurn.function.js';
import { cleanupGuests } from '../modules/demo/guestCleanup.function.js';
import { ingestSource } from '../modules/ingestion/ingest.function.js';
import { extractMemoriesFunction } from '../modules/memory/memory.function.js';
import { isCleanupPrefix } from '../modules/sources/source.storage.js';
import { generateStudyArtifact } from '../modules/study/study.function.js';
import { deletePrefix } from '../utils/storage.js';
import { sourceDeleted, workspaceDeleted } from './events.js';
import { pruneRateLimits } from './pruneRateLimits.function.js';

function cleanupStorage(prefix: string) {
  if (!isCleanupPrefix(prefix)) throw new NonRetriableError(`Refusing to delete "${prefix}"`);
  return deletePrefix(prefix);
}

const cleanupSourceStorage = inngest.createFunction(
  { id: 'cleanup-source-storage', triggers: [sourceDeleted] },
  async ({ event, step }) => {
    const deleted = await step.run('delete-files', () => cleanupStorage(event.data.storagePrefix));
    return { deleted };
  },
);

const cleanupWorkspaceStorage = inngest.createFunction(
  { id: 'cleanup-workspace-storage', triggers: [workspaceDeleted] },
  async ({ event, step }) => {
    const deleted = await step.run('delete-files', () => cleanupStorage(event.data.storagePrefix));
    return { deleted };
  },
);

export const functions = [
  ingestSource,
  cleanupSourceStorage,
  cleanupWorkspaceStorage,
  pruneRateLimits,
  afterTurn,
  extractMemoriesFunction,
  generateStudyArtifact,
  cleanupGuests,
];
