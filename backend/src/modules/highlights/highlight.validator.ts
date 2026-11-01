import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import { paginationQuerySchema } from '../../utils/helpers/pagination.helpers.js';
import { text } from '../sources/source.validator.js';

const { maxTextChars, maxNoteChars } = appConfig.highlights;

// Postgres int4, as for source content.
const line = z.int().min(1).max(2_000_000_000);

// An empty note is stored as no note.
const note = z
  .string()
  .max(maxNoteChars)
  .refine((value) => !value.includes('\0'), 'Must not contain NUL characters')
  .transform((value) => value.trim() || null);

export const highlightParamsSchema = z.object({ highlightId: z.cuid() });

export const listHighlightsQuerySchema = paginationQuerySchema.extend({
  sourceId: z.cuid().optional(),
});

// Where the passage is: a page of a PDF, or a file of a repository or website (lines for
// code), as the viewer addresses it.
export const createHighlightSchema = z
  .object({
    sourceId: z.cuid(),
    page: line.optional(),
    path: text(1_000).optional(),
    lineStart: line.optional(),
    lineEnd: line.optional(),
    heading: text(500).trim().min(1).optional(),
    text: text(maxTextChars).trim().min(1),
    note: note.optional(),
  })
  .refine((body) => (body.page === undefined) !== (body.path === undefined), {
    message: 'Give one of page or path',
  })
  .refine(
    (body) =>
      body.path !== undefined || (body.lineStart === undefined && body.lineEnd === undefined),
    { message: 'lineStart and lineEnd go with path' },
  )
  .refine(
    (body) =>
      body.lineStart === undefined || body.lineEnd === undefined || body.lineEnd >= body.lineStart,
    { message: 'lineEnd must not be before lineStart' },
  );

// The note is all that changes; null or an empty string clears it.
export const updateHighlightSchema = z.object({ note: note.nullable() });
