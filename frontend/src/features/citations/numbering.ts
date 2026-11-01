import type { Citation } from '@/api/types';
import { citedOrder } from '@/features/chat/markers';

export type Note = { citation: Citation; shown: number };

/**
 * Numbers the citations the way a reader counts them: 1, 2, 3 in the order the text first
 * cites them. `numbers` maps the registry number (what the address carries) to that count.
 * Valid citations the text never mentions follow, so every note has a number.
 */
export function numberCitations(text: string, citations: Citation[]) {
  const numbers = new Map<number, number>();
  for (const n of citedOrder(text)) numbers.set(n, numbers.size + 1);
  const valid = citations.filter((c) => c.valid).sort((a, b) => a.n - b.n);
  for (const c of valid) if (!numbers.has(c.n)) numbers.set(c.n, numbers.size + 1);
  const notes: Note[] = valid
    .map((citation) => ({ citation, shown: numbers.get(citation.n)! }))
    .sort((a, b) => a.shown - b.shown);
  return { numbers, notes };
}
