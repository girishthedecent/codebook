import { appConfig } from '../../config/app.config.js';
import { countTokens } from '../../utils/tokens.js';
import type { ChildSpan, ChunkPlan, ChunkSpan, TocEntry } from './ingestion.types.js';
import { pageAt, pageStarts } from './pageMap.js';

export type ChunkSettings = {
  parentMaxTokens: number;
  childTokens: number;
  overlapTokens: number;
  minSectionTokens: number;
};

// A piece of text that is never split further: a sentence, or part of an over-long one.
export type Unit = { start: number; end: number; tokens: number };
type Section = { start: number; end: number; headingPath: string[] };

// Sentence ends: punctuation (and closing quotes or brackets) followed by space and
// something that starts a sentence. Blank lines and page breaks end one too.
const SENTENCE_END = /[.!?]["')\]]*\s+(?=["'([•A-Z0-9])|\n[ \t]*\n|\f/g;

/** The text a chunk shows and embeds: page breaks become line breaks. */
export function chunkText(content: string, start: number, end: number) {
  return content.slice(start, end).replaceAll('\f', '\n');
}

/**
 * Splits a document into parent chunks (a TOC section, or a balanced part of a long one)
 * and overlapping child chunks inside each parent. Children are what search matches;
 * parents are what the model reads around a match.
 */
export function chunkDocument(
  content: string,
  toc: TocEntry[],
  settings: ChunkSettings = appConfig.ingestion.chunking,
): ChunkPlan {
  const starts = pageStarts(content);
  const span = (first: Unit, last: Unit, headingPath: string[]): ChunkSpan => ({
    start: first.start,
    end: last.end,
    headingPath,
    pageStart: pageAt(starts, first.start),
    pageEnd: pageAt(starts, last.end - 1),
    lineStart: null,
    lineEnd: null,
    symbolName: null,
    tokenCount: countTokens(chunkText(content, first.start, last.end)),
  });

  const plan: ChunkPlan = { parents: [], children: [] };
  for (const section of sections(content, toc, settings)) {
    const units = unitsOf(content, section, settings.childTokens);
    for (const parentUnits of splitParents(units, settings.parentMaxTokens)) {
      const parentIndex = plan.parents.length;
      plan.parents.push(span(parentUnits[0]!, parentUnits.at(-1)!, section.headingPath));
      for (const [from, to] of childRanges(parentUnits, settings)) {
        const child: ChildSpan = {
          ...span(parentUnits[from]!, parentUnits[to - 1]!, section.headingPath),
          parentIndex,
        };
        plan.children.push(child);
      }
    }
  }
  return plan;
}

// Text between consecutive TOC entries, with the heading path of the entry it belongs to.
// Text before the first entry is a section of its own.
function sections(content: string, toc: TocEntry[], settings: ChunkSettings) {
  const owners = new Map<number, number>();
  // When several entries start at the same place (a chapter and its first section), the
  // deepest, which comes last, owns the text.
  toc.forEach((entry, i) => owners.set(entry.charStart, i));
  const boundaries = [...owners.keys()].sort((a, b) => a - b);
  if (boundaries[0] !== 0) boundaries.unshift(0);

  const result: Section[] = boundaries.map((start, i) => {
    const owner = owners.get(start);
    return {
      start,
      end: boundaries[i + 1] ?? content.length,
      headingPath: owner === undefined ? [] : headingPath(toc, owner),
    };
  });

  // A section with almost no text (a "Part II" title page) joins the next one, which is
  // where its reader is headed; a tiny last section joins the one before.
  const merged: Section[] = [];
  for (let i = 0; i < result.length; i++) {
    const section = result[i]!;
    const tiny =
      countTokens(content.slice(section.start, section.end).trim()) < settings.minSectionTokens;
    if (tiny && i + 1 < result.length) {
      result[i + 1]!.start = section.start;
    } else if (tiny && merged.length > 0) {
      merged.at(-1)!.end = section.end;
    } else {
      merged.push(section);
    }
  }
  return merged;
}

function headingPath(toc: TocEntry[], index: number) {
  const path: string[] = [];
  for (let i: number | null = index; i !== null; i = toc[i]!.parentIndex) {
    path.unshift(toc[i]!.title);
  }
  return path;
}

function unitsOf(content: string, section: Section, maxTokens: number): Unit[] {
  const text = content.slice(section.start, section.end);
  const cuts = [
    0,
    ...[...text.matchAll(SENTENCE_END)].map((m) => m.index + m[0].length),
    text.length,
  ];
  const units: Unit[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const range = trimRange(content, section.start + cuts[i]!, section.start + cuts[i + 1]!);
    if (range) units.push(...splitLong(content, range, maxTokens));
  }
  return units;
}

export function trimRange(content: string, start: number, end: number) {
  while (start < end && /\s/.test(content[start]!)) start++;
  while (end > start && /\s/.test(content[end - 1]!)) end--;
  return start < end ? { start, end } : null;
}

// A "sentence" longer than a child (code, a table, a list without full stops) is split at
// line breaks, then at spaces; a single word longer than that is cut where it has to be.
export function splitLong(
  content: string,
  range: { start: number; end: number },
  maxTokens: number,
): Unit[] {
  const tokens = countTokens(content.slice(range.start, range.end));
  if (tokens <= maxTokens) return [{ ...range, tokens }];

  for (const separator of ['\n', ' ']) {
    const text = content.slice(range.start, range.end);
    const middle = text.lastIndexOf(separator, Math.floor(text.length / 2));
    const at = middle > 0 ? middle : text.indexOf(separator, Math.floor(text.length / 2));
    if (at > 0) {
      const left = trimRange(content, range.start, range.start + at);
      const right = trimRange(content, range.start + at + 1, range.end);
      return [left, right].flatMap((part) => (part ? splitLong(content, part, maxTokens) : []));
    }
  }
  const middle = range.start + Math.floor((range.end - range.start) / 2);
  return [
    ...splitLong(content, { start: range.start, end: middle }, maxTokens),
    ...splitLong(content, { start: middle, end: range.end }, maxTokens),
  ];
}

// A long section becomes several parents of about equal size instead of full ones and a
// small remainder.
export function splitParents(units: Unit[], maxTokens: number) {
  const total = units.reduce((sum, unit) => sum + unit.tokens, 0);
  const target = total / Math.ceil(total / maxTokens);
  const parents: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  for (const unit of units) {
    if (current.length > 0 && (size >= target || size + unit.tokens > maxTokens)) {
      parents.push(current);
      current = [];
      size = 0;
    }
    current.push(unit);
    size += unit.tokens;
  }
  if (current.length > 0) parents.push(current);
  return parents;
}

/**
 * Children as [from, to) unit ranges: packed up to `childTokens`, each starting with the
 * last whole sentences of the one before (up to `overlapTokens`). A last child with
 * hardly anything new is folded into the previous one.
 */
export function childRanges(units: Unit[], settings: ChunkSettings): [number, number][] {
  const ranges: [number, number][] = [];
  let from = 0;
  while (from < units.length) {
    let to = from;
    let size = 0;
    while (to < units.length && (to === from || size + units[to]!.tokens <= settings.childTokens)) {
      size += units[to]!.tokens;
      to++;
    }
    ranges.push([from, to]);
    if (to >= units.length) break;

    // Step back over whole units for the overlap, but only as far as still leaves room for
    // the next new unit: a child that is all overlap would repeat the end of this one.
    let next = to;
    let overlap = 0;
    while (
      next - 1 > from &&
      overlap + units[next - 1]!.tokens <= settings.overlapTokens &&
      overlap + units[next - 1]!.tokens + units[to]!.tokens <= settings.childTokens
    ) {
      next--;
      overlap += units[next]!.tokens;
    }
    from = next;
  }

  if (ranges.length >= 2) {
    const [, previousEnd] = ranges.at(-2)!;
    const [, lastEnd] = ranges.at(-1)!;
    const fresh = units.slice(previousEnd, lastEnd).reduce((sum, unit) => sum + unit.tokens, 0);
    if (fresh < settings.minSectionTokens) {
      ranges.pop();
      ranges.at(-1)![1] = lastEnd;
    }
  }
  return ranges;
}
