/**
 * Locating a cited passage inside text that was extracted differently (pdf.js text items,
 * stored page text). The snippet is whitespace-collapsed and may end in "…", so an exact
 * search rarely works: we look for the longest run of the snippet's words that occurs
 * exactly once in the haystack, and return its character range there.
 */

const MIN_WORDS = 4;

export type Range = { start: number; end: number };

function normalize(text: string) {
  return text.toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');
}

export function findSnippet(haystack: string, snippet: string | undefined): Range | undefined {
  if (!snippet) return undefined;
  const hay = normalize(haystack);
  const words = normalize(snippet.replace(/…$/, '')).trim().split(' ').filter(Boolean);
  if (words.length < MIN_WORDS) return undefined;

  for (let size = words.length; size >= MIN_WORDS; size--) {
    for (let from = 0; from + size <= words.length; from++) {
      const needle = words.slice(from, from + size).join(' ');
      const at = hay.indexOf(needle);
      if (at === -1 || hay.indexOf(needle, at + 1) !== -1) continue;
      return mapBack(haystack, at, at + needle.length);
    }
  }
  return undefined;
}

/**
 * A passage the reader marked, which is shorter and exact: the snippet search first, since it
 * copes with text extracted differently, then the first plain occurrence for a few words.
 */
export function findPassage(haystack: string, passage: string): Range | undefined {
  return findSnippet(haystack, passage) ?? findAll(haystack, passage, 1)[0];
}

/** Every occurrence of `query`, ignoring case and runs of whitespace, in order. */
export function findAll(haystack: string, query: string, max = 1_000): Range[] {
  const needle = normalize(query).trim();
  if (!needle) return [];
  const { text, map } = normalizeWithMap(haystack);
  const hits: Range[] = [];
  for (let at = text.indexOf(needle); at !== -1 && hits.length < max;) {
    hits.push({ start: map[at]!, end: map[at + needle.length - 1]! + 1 });
    at = text.indexOf(needle, at + needle.length);
  }
  return hits;
}

// normalize(), one character at a time, remembering where each kept character came from.
// A character whose lower case is longer (a dotted capital I) is kept as it is, so the
// positions stay one to one.
function normalizeWithMap(original: string) {
  let text = '';
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < original.length; i++) {
    const ch = original[i]!;
    const space = /\s/.test(ch);
    if (space && inSpace) continue;
    inSpace = space;
    const lower = ch.toLowerCase();
    text += space ? ' ' : /[‐-―]/.test(ch) ? '-' : lower.length === 1 ? lower : ch;
    map.push(i);
  }
  return { text, map };
}

// normalize() collapses whitespace, so offsets in the normalized text drift from the
// original. Walk the original once and translate.
function mapBack(original: string, start: number, end: number): Range {
  let n = 0;
  let inSpace = false;
  let from = 0;
  let to = original.length;
  for (let i = 0; i < original.length; i++) {
    const space = /\s/.test(original[i]!);
    if (space && inSpace) continue;
    inSpace = space;
    if (n === start) from = i;
    n++;
    if (n === end) {
      to = i + 1;
      break;
    }
  }
  return { start: from, end: to };
}
