import type { z } from 'zod';
import type { Highlight, Source } from '../../generated/prisma/client.js';
import type {
  createHighlightSchema,
  highlightParamsSchema,
  listHighlightsQuerySchema,
  updateHighlightSchema,
} from './highlight.validator.js';

export type HighlightParams = z.infer<typeof highlightParamsSchema>;
export type ListHighlightsQuery = z.infer<typeof listHighlightsQuerySchema>;
export type CreateHighlightInput = z.infer<typeof createHighlightSchema>;
export type UpdateHighlightInput = z.infer<typeof updateHighlightSchema>;

export type HighlightWithSource = Highlight & { source: Pick<Source, 'title' | 'type'> };

export function toHighlightResponse(highlight: HighlightWithSource) {
  return {
    id: highlight.id,
    sourceId: highlight.sourceId,
    sourceTitle: highlight.source.title,
    sourceType: highlight.source.type,
    page: highlight.page,
    path: highlight.path,
    lineStart: highlight.lineStart,
    lineEnd: highlight.lineEnd,
    heading: highlight.heading,
    text: highlight.text,
    note: highlight.note,
    createdAt: highlight.createdAt,
  };
}
