import { appConfig } from '../../../config/app.config.js';
import { chunkDocument, type ChunkSettings } from '../doc.chunker.js';
import type { ChunkPlan, TocEntry } from '../ingestion.types.js';
import { withLines } from './lines.js';

const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;

export type Fence = { char: string; length: number };

/**
 * The fence a line opens, CommonMark style: 3 or more backticks or tildes (a backtick
 * fence's info string can't contain a backtick).
 */
export function openingFence(line: string): Fence | null {
  const match = FENCE.exec(line);
  if (!match || (match[1]![0] === '`' && match[2]!.includes('`'))) return null;
  return { char: match[1]![0]!, length: match[1]!.length };
}

/** True when the line closes `fence`: the same character, at least as many, nothing else. */
export function closesFence(line: string, fence: Fence) {
  const match = FENCE.exec(line);
  return (
    match !== null &&
    match[1]![0] === fence.char &&
    match[1]!.length >= fence.length &&
    match[2]!.trim() === ''
  );
}

/** `#` headings outside fenced code blocks, as TOC entries for the doc chunker. */
export function markdownHeadings(text: string): TocEntry[] {
  const entries: TocEntry[] = [];
  // The entry each level last opened, to find parents.
  const open: number[] = [];
  let fence: Fence | null = null;
  let offset = 0;
  for (const line of text.split('\n')) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
    } else {
      fence = openingFence(line);
      const heading = fence ? null : HEADING.exec(line);
      const title = heading ? headingTitle(heading[2]!) : '';
      if (heading && title) {
        const level = heading[1]!.length;
        open.length = level - 1;
        const parentIndex = open.findLast((index) => index !== undefined) ?? null;
        entries.push({
          title,
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
  // Each entry ends where the next one at its level or above starts. One pass with a stack
  // of entries still open: web pages are untrusted and can have a million headings.
  const unclosed: TocEntry[] = [];
  for (const entry of entries) {
    while (unclosed.length > 0 && unclosed.at(-1)!.level >= entry.level) {
      unclosed.pop()!.charEnd = entry.charStart;
    }
    unclosed.push(entry);
  }
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

// Drops a heading's closing `#`s and spaces by hand: a regex for that backtracks
// quadratically on a long line of ` # # #`.
function headingTitle(text: string) {
  let end = text.length;
  while (end > 0 && ' \t#'.includes(text[end - 1]!)) end--;
  return text.slice(0, end);
}
