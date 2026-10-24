import { appConfig } from '../../../config/app.config.js';
import { countTokens } from '../../../utils/tokens.js';
import {
  childRanges,
  chunkText,
  splitLong,
  splitParents,
  trimRange,
  type ChunkSettings,
  type Unit,
} from '../doc.chunker.js';
import type { ChunkPlan, ChunkSpan } from '../ingestion.types.js';
import { withLines } from './lines.js';

/**
 * Chunks a file by whole lines, for languages without a parser (and code that didn't
 * parse): children packed from lines with a few lines of overlap, parents from runs of
 * children. A line longer than a child is split like an over-long sentence.
 */
export function chunkLines(
  text: string,
  path: string,
  settings: ChunkSettings = appConfig.ingestion.chunking,
): ChunkPlan {
  const units: Unit[] = [];
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    // Indentation stays with its line, so token counts match the chunk text.
    const range = trimRange(text, lineStart, lineEnd);
    if (range) units.push(...splitLong(text, { ...range, start: lineStart }, settings.childTokens));
    lineStart = lineEnd + 1;
  }

  const span = (first: Unit, last: Unit): ChunkSpan => ({
    start: first.start,
    end: last.end,
    headingPath: [path],
    pageStart: null,
    pageEnd: null,
    lineStart: null,
    lineEnd: null,
    symbolName: null,
    tokenCount: countTokens(chunkText(text, first.start, last.end)),
  });
  const plan: ChunkPlan = { parents: [], children: [] };
  for (const parentUnits of units.length > 0 ? splitParents(units, settings.parentMaxTokens) : []) {
    const parentIndex = plan.parents.length;
    plan.parents.push(span(parentUnits[0]!, parentUnits.at(-1)!));
    for (const [from, to] of childRanges(parentUnits, settings)) {
      plan.children.push({ ...span(parentUnits[from]!, parentUnits[to - 1]!), parentIndex });
    }
  }
  return withLines(text, plan);
}
