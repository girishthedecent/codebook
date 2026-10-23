import type { TocEntry } from './ingestion.types.js';
import { pageAt, pageStarts } from './pageMap.js';
import type { PdfOutlineItem } from './pdf/pdf.parser.js';
import { squash } from './pdf/pdf.text.js';

export type Heading = { title: string; level: number; page: number };

// Numbered headings like "7.3 Hash Tables" (a capital after the number, short, no final
// period) and "Chapter 7"; used only when a PDF has no outline.
const NUMBERED_HEADING = /^(\d+(?:\.\d+){0,3})\.?\s+([A-Z][^\n]{0,78})$/;
const CHAPTER_HEADING = /^chapter\s+(\d+)\b/i;

/**
 * The table of contents of a PDF, for its cleaned pages (joined with \f into the document
 * text): from the outline's headings when it has any, else from numbered headings found in
 * the text, else a single "Document" node. Entries are in reading order; each covers its
 * own text and its subsections'.
 */
export function buildToc(pages: string[], outline: Heading[]): TocEntry[] {
  if (outline.length > 0) return toEntries(pages, outline);
  const detected = detectHeadings(pages);
  return detected.length >= 2 ? toEntries(pages, detected) : [wholeDocument(pages)];
}

/** Outline items in reading order with their depth; bookmarks without a page are left out. */
export function outlineHeadings(items: PdfOutlineItem[], level = 1): Heading[] {
  return items.flatMap((item) => [
    ...(item.page !== null && item.title ? [{ title: item.title, level, page: item.page }] : []),
    ...outlineHeadings(item.items, level + 1),
  ]);
}

function detectHeadings(pages: string[]): Heading[] {
  const headings: Heading[] = [];
  pages.forEach((text, i) => {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      const numbered = NUMBERED_HEADING.exec(trimmed);
      if (numbered && !trimmed.endsWith('.')) {
        headings.push({ title: trimmed, level: numbered[1]!.split('.').length, page: i + 1 });
      } else if (CHAPTER_HEADING.test(trimmed) && trimmed.length <= 80) {
        headings.push({ title: trimmed, level: 1, page: i + 1 });
      }
    }
  });
  return headings;
}

function wholeDocument(pages: string[]): TocEntry {
  const content = pages.join('\f');
  return {
    title: 'Document',
    number: null,
    level: 1,
    parentIndex: null,
    charStart: 0,
    charEnd: content.length,
    pageStart: 1,
    pageEnd: Math.max(pages.length, 1),
  };
}

function toEntries(pages: string[], headings: Heading[]): TocEntry[] {
  const content = pages.join('\f');
  const starts = pageStarts(content);

  // Where each heading starts. Searched after the previous one when they share a page, and
  // never before it, so entries stay in reading order.
  const offsets: number[] = [];
  headings.forEach((heading, i) => {
    const previous = offsets[i - 1] ?? 0;
    const pageStart = starts[heading.page - 1] ?? content.length;
    const from = Math.max(pageStart, previous);
    const pageEnd = (starts[heading.page] ?? content.length + 1) - 1;
    const found = findTitle(content.slice(from, pageEnd), heading.title);
    offsets.push(Math.max(found === -1 ? pageStart : from + found, previous));
  });

  const parents: (number | null)[] = [];
  const stack: number[] = [];
  headings.forEach((heading, i) => {
    while (stack.length > 0 && headings[stack.at(-1)!]!.level >= heading.level) stack.pop();
    parents.push(stack.at(-1) ?? null);
    stack.push(i);
  });

  return headings.map((heading, i) => {
    // A section runs to the next heading at the same or a higher level.
    let end = content.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= heading.level) {
        end = offsets[j]!;
        break;
      }
    }
    const start = offsets[i]!;
    return {
      title: heading.title,
      number: headingNumber(heading.title),
      level: heading.level,
      parentIndex: parents[i]!,
      charStart: start,
      charEnd: end,
      pageStart: pageAt(starts, start),
      pageEnd: pageAt(starts, Math.max(start, end - 1)),
    };
  });
}

/**
 * Offset of the line where `title` appears in `text`, or -1. Titles wrap, so up to three
 * lines are joined; "Chapter 1. Reliable…" in the outline matches "CHAPTER 1" followed by
 * "Reliable…" on the page.
 */
export function findTitle(text: string, title: string) {
  const target = squash(title);
  if (!target) return -1;
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    let joined = '';
    for (let k = i; k < Math.min(i + 3, lines.length); k++) {
      joined += squash(lines[k]!);
      if (joined === target) return offset;
      if (!target.startsWith(joined)) break;
    }
    offset += lines[i]!.length + 1;
  }
  return -1;
}

function headingNumber(title: string) {
  const match = /^(?:chapter\s+)?(\d+(?:\.\d+)*)\b/i.exec(title);
  return match?.[1] ?? null;
}
