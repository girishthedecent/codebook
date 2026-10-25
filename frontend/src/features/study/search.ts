import { z } from 'zod';

/**
 * Flashcard progress lives in the URL so a reload or a shared link keeps your place.
 * `know` / `again` are comma-separated card ids; `pile=again` reviews only the again pile.
 * `kind` is the list's type filter, kept here so going back from a set on a phone restores it.
 */
export const studySearchSchema = z.object({
  card: z.coerce.number().int().min(1).optional(),
  know: z.string().optional(),
  again: z.string().optional(),
  pile: z.enum(['again']).optional(),
  kind: z.enum(['QUIZ', 'FLASHCARDS', 'MINDMAP', 'SUMMARY']).optional().catch(undefined),
});

export type StudySearch = z.infer<typeof studySearchSchema>;

export const idSet = (csv?: string) => new Set(csv ? csv.split(',').filter(Boolean) : []);
export const idCsv = (ids: Set<string>) => (ids.size ? [...ids].join(',') : undefined);
