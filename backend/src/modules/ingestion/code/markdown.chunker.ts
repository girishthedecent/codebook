import { appConfig } from '../../../config/app.config.js';
import { chunkDocument, type ChunkSettings } from '../doc.chunker.js';
import type { ChunkPlan, TocEntry } from '../ingestion.types.js';
import { withLines } from './lines.js';

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/;
const FENCE = /^[ \t]{0,3}(```|~~~)/;

/** `#` headings outside fenced code blocks, as TOC entries for the doc chunker. */
export function markdownHeadings(text: string): TocEntry[] {
  const entries: TocEntry[] = [];
  // The entry each level last opened, to find parents.
  const open: number[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of text.split('\n')) {
    const fenceMark = FENCE.exec(line)?.[1];
    if (fenceMark && (fence === null || fence === fenceMark)) {
      fence = fence === null ? fenceMark : null;
    } else if (fence === null) {
      const heading = HEADING.exec(line);
      if (heading) {
        const level = heading[1]!.length;
        open.length = level - 1;
        const parentIndex = open.findLast((index) => index !== undefined) ?? null;
        entries.push({
          title: heading[2]!,
          number: null,
          level,
          parentIndex,
          charStart: offset,
          charEnd: text.length,
          pageStart: null,
          pageEnd: null,
        });
        open[level - 1] = entries.length - 1;
      }
    }
    offset += line.length + 1;
  }
  // Each entry ends where the next one at its level or above starts.
  entries.forEach((entry, i) => {
    const next = entries.slice(i + 1).find((later) => later.level <= entry.level);
    if (next) entry.charEnd = next.charStart;
  });
  return entries;
}

/** A markdown file chunked by its headings, with the file path first in every heading path. */
export function chunkMarkdown(
  text: string,
  path: string,
  settings: ChunkSettings = appConfig.ingestion.chunking,
): ChunkPlan {
  const plan = withLines(text, chunkDocument(text, markdownHeadings(text), settings));
  const withPath = <T extends { headingPath: string[] }>(chunk: T) => ({
    ...chunk,
    headingPath: [path, ...chunk.headingPath],
  });
  return { parents: plan.parents.map(withPath), children: plan.children.map(withPath) };
}
