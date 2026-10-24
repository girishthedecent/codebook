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
