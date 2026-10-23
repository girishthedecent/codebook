import { NonRetriableError } from 'inngest';
import { inngest } from '../config/inngest.config.js';
import { setIngestState } from '../modules/sources/source.repository.js';
import { isCleanupPrefix } from '../modules/sources/source.storage.js';
import { deletePrefix } from '../utils/storage.js';
import { sourceDeleted, sourceIngestRequested, workspaceDeleted } from './events.js';

// Stand-in until Phase 5 adds the real pipeline: marks the source READY so the rest of
// the flow (queue, progress stream, UI states) can be exercised end to end.
const ingestSource = inngest.createFunction(
  {
    id: 'ingest-source',
    triggers: [sourceIngestRequested],
    // One run per source at a time, so a resync can't overlap a running ingest.
    concurrency: { key: 'event.data.sourceId', limit: 1 },
    onFailure: async ({ event }) => {
      await setIngestState(event.data.event.data.sourceId, {
        status: 'FAILED',
        error: 'Processing failed. Try a resync.',
      });
    },
  },
  async ({ event, step }) => {
    const { sourceId } = event.data;

    const found = await step.run('start', () =>
      setIngestState(sourceId, { status: 'PROCESSING', stage: 'FETCHING', progress: 0 }),
    );
    if (!found) return { sourceId, skipped: 'source was deleted' };

    await step.run('finish', () =>
      setIngestState(sourceId, {
        status: 'READY',
        stage: 'DONE',
        progress: 100,
        lastIngestedAt: new Date(),
      }),
    );
    return { sourceId };
  },
);

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

export const functions = [ingestSource, cleanupSourceStorage, cleanupWorkspaceStorage];
