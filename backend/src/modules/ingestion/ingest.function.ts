import { appConfig } from '../../config/app.config.js';
import { inngest } from '../../config/inngest.config.js';
import logger from '../../config/logger.config.js';
import { sourceDeleted, sourceIngestRequested } from '../../inngest/events.js';
import {
  contextualizeStep,
  embedStep,
  failIngestService,
  indexStep,
  prepareSource,
  startIngest,
} from './ingestion.service.js';

/**
 * A source's ingest run: prepare (download, parse, TOC, chunk plan → draft row), then
 * contextualize and embed in batches, then swap the new index in. Each step's work is
 * cached, so a retried step or a rerun only pays for what's missing, and the old index
 * stays live until the last step commits.
 *
 * Decisions between steps only use what earlier steps returned: Inngest replays this body
 * from the top for every step, with finished steps answered from their stored results.
 */
export const ingestSource = inngest.createFunction(
  {
    id: 'ingest-source',
    triggers: [sourceIngestRequested],
    // Limits running steps, not runs: two runs of one source can still interleave (e.g.
    // after a resync of a stuck run), which is why the draft records the run that owns it.
    concurrency: [
      { key: 'event.data.sourceId', limit: 1 },
      { limit: appConfig.ingestion.concurrency },
    ],
    retries: 3,
    cancelOn: [{ event: sourceDeleted, match: 'data.sourceId' }],
    onFailure: async ({ event }) => {
      const failed = event.data.event;
      // Inngest stamps every event; without a stamp, treat the run as queued just now.
      const queuedAt = new Date(failed.ts ?? Date.now());
      await failIngestService(failed.data.sourceId, event.data.run_id, queuedAt);
    },
  },
  async ({ event, step, runId }) => {
    const { sourceId } = event.data;
    const timed = <T>(name: string, work: () => Promise<T>) =>
      step.run(name, async () => {
        const started = performance.now();
        const result = await work();
        logger.info('Ingest step done', {
          sourceId,
          step: name,
          ms: Math.round(performance.now() - started),
        });
        return result;
      });

    if (!(await timed('load-source', () => startIngest(sourceId)))) {
      return { sourceId, outcome: 'gone' };
    }

    const prepared = await timed('prepare', () => prepareSource(sourceId, runId));
    if (prepared.outcome !== 'draft') return { sourceId, outcome: prepared.outcome };

    for (let i = 0; i < prepared.contextSteps; i++) {
      const result = await timed(`contextualize-${i}`, () => contextualizeStep(sourceId, runId, i));
      // No draft for this run: the source was deleted, or a newer run took over.
      if (!result) return { sourceId, outcome: 'stopped' };
      // Every call in the batch failed: the day's quota is likely gone, so the rest of the
      // chunks go without context instead of failing one by one. A resync fills them in.
      if (result.done === 0 && result.failed > 0) break;
    }

    for (let i = 0; i < prepared.embedSteps; i++) {
      const result = await timed(`embed-${i}`, () => embedStep(sourceId, runId, i));
      if (!result) return { sourceId, outcome: 'stopped' };
    }

    const indexed = await timed('index', () => indexStep(sourceId, runId));
    return { sourceId, ...indexed };
  },
);
