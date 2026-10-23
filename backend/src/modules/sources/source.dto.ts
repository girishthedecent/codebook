import type { z } from 'zod';
import type { Source } from '../../generated/prisma/client.js';
import type {
  createSourceSchema,
  sourceParamsSchema,
  uploadFieldsSchema,
} from './source.validator.js';

export type CreateSourceInput = z.infer<typeof createSourceSchema>;
export type UploadFields = z.infer<typeof uploadFieldsSchema>;
export type SourceParams = z.infer<typeof sourceParamsSchema>;

export type PdfOrigin = { storageKey: string | null; fileName: string; size: number; mime: string };
export type RepoOrigin = { owner: string; repo: string; ref: string; defaultBranch: string };
export type WebsiteOrigin = { url: string; maxDepth: number; maxPages: number };

export type SourceResponse = {
  id: string;
  workspaceId: string;
  type: Source['type'];
  title: string;
  status: Source['status'];
  stage: Source['stage'];
  progress: number;
  error: string | null;
  origin: Record<string, unknown>;
  stats: Record<string, unknown>;
  lastIngestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// The storage key is internal; clients only see the file's name and size.
function publicOrigin(source: Source) {
  const { storageKey: _, ...rest } = source.origin as Record<string, unknown>;
  return rest;
}

// Picked field by field so columns added later don't end up in responses by accident.
export function toSourceResponse(source: Source): SourceResponse {
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    type: source.type,
    title: source.title,
    status: source.status,
    stage: source.stage,
    progress: source.progress,
    error: source.error,
    origin: publicOrigin(source),
    stats: source.stats as Record<string, unknown>,
    lastIngestedAt: source.lastIngestedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

/** What the progress stream sends: the parts of a source that change during ingestion. */
export function toProgress(source: Source) {
  return {
    status: source.status,
    stage: source.stage,
    progress: source.progress,
    error: source.error,
  };
}
