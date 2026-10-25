import { eventType } from 'inngest';
import { z } from 'zod';

// Every event the app sends. inngest.send() validates the data against these schemas.

export const sourceIngestRequested = eventType('source/ingest.requested', {
  schema: z.object({
    sourceId: z.string(),
    reason: z.enum(['created', 'resync']),
  }),
});

// Sent after the rows are gone; the listener deletes the stored files.
export const sourceDeleted = eventType('source/deleted', {
  schema: z.object({
    sourceId: z.string(),
    storagePrefix: z.string(),
  }),
});

export const workspaceDeleted = eventType('workspace/deleted', {
  schema: z.object({
    workspaceId: z.string(),
    storagePrefix: z.string(),
  }),
});

export const conversationTurnCompleted = eventType('conversation/turn.completed', {
  schema: z.object({ conversationId: z.string(), messageId: z.string() }),
});

export const studyGenerateRequested = eventType('study/generate.requested', {
  schema: z.object({ artifactId: z.string() }),
});

// Picked up by the eval worker (pnpm evals:worker), not by the API server.
export const evalRunRequested = eventType('eval/run.requested', {
  schema: z.object({
    suite: z.string(),
    config: z.string(),
    dataset: z.string(),
    split: z.enum(['DEV', 'HELDOUT']),
    limit: z.int().positive().optional(),
    tags: z.array(z.string()).optional(),
    resume: z.string().optional(),
    requestedBy: z.string(),
  }),
});
