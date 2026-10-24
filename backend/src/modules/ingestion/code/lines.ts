import type { ChunkPlan } from '../ingestion.types.js';
import { pageAt } from '../pageMap.js';

/** Offsets where each line starts; entry 0 is line 1. */
export function lineStarts(text: string) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** The 1-based line that holds the character at `offset` (the same search as for pages). */
export const lineAt = pageAt;

/** Lines in a file the way GitHub counts them: a final newline doesn't start another. */
export function countLines(text: string) {
  if (text === '') return 0;
  return lineStarts(text).length - (text.endsWith('\n') ? 1 : 0);
}

/** Sets line ranges on every chunk of a file's plan; files have no pages. */
export function withLines(text: string, plan: ChunkPlan): ChunkPlan {
  const starts = lineStarts(text);
  const lines = <T extends { start: number; end: number }>(chunk: T) => ({
    ...chunk,
    pageStart: null,
    pageEnd: null,
    lineStart: lineAt(starts, chunk.start),
    lineEnd: lineAt(starts, chunk.end - 1),
  });
  return { parents: plan.parents.map(lines), children: plan.children.map(lines) };
}
