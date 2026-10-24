import type { ScoredId } from './retrieval.repository.js';

export type Fused = { id: string; rrf: number };

/**
 * Reciprocal rank fusion: each list adds weight / (k + rank) for every id in it, so an id
 * near the top of several lists beats one at the top of a single list, and the lists' own
 * score scales never matter. Ties go to the better vector score, then the id, so the order
 * is stable from run to run.
 */
export function rrf(
  lists: ScoredId[][],
  k: number,
  vectorScores = new Map<string, number>(),
  weights: number[] = [],
) {
  const scores = new Map<string, number>();
  lists.forEach((list, i) => {
    const weight = weights[i] ?? 1;
    list.forEach(({ id }, index) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + index + 1));
    });
  });
  return [...scores]
    .map(([id, score]): Fused => ({ id, rrf: score }))
    .sort(
      (a, b) =>
        b.rrf - a.rrf ||
        (vectorScores.get(b.id) ?? -Infinity) - (vectorScores.get(a.id) ?? -Infinity) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** The best score each id got in any of the lists. */
export function bestScores(lists: ScoredId[][]) {
  const best = new Map<string, number>();
  for (const list of lists) {
    for (const { id, score } of list) {
      if (score > (best.get(id) ?? -Infinity)) best.set(id, score);
    }
  }
  return best;
}
