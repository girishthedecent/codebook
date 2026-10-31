import { appConfig } from '../../../config/app.config.js';

// Arabic, or short lowercase roman as in front matter ("xiv"). Not d/m, so words like "did"
// or "mix" alone on a line aren't taken for page numbers.
const PAGE_NUMBER = String.raw`(?:\d+|[ivxlc]{1,6})`;
const BARE_PAGE_NUMBER = new RegExp(`^${PAGE_NUMBER}$`);
// Running heads like "12 | Chapter 2: Data Models" or "Replication | 13"; a single bar, so
// code such as "c || d" isn't one.
const NUMBERED_HEAD = new RegExp(
  `^${PAGE_NUMBER}\\s*\\|(?!\\|)\\s*\\S|\\S\\s*(?<!\\|)\\|\\s*${PAGE_NUMBER}$`,
);
// A running head repeats with only its page number changing, and is short.
const MIN_REPEATS = 3;
const MAX_HEAD_LENGTH = 100;
// Chapter openers repeat that way too ("CHAPTER 1", "CHAPTER 2", ...) but must stay.
const CHAPTER_LINE = /^chapter\s+\d+$/i;

// Some PDFs draw a word as many overlapping copies (a fade, or fake bold), and the text layer
// then holds every copy, cut into pieces: "DeepDeepDeep learnlearninginginging". A piece of
// two or more letters repeated four times or more in a row is one copy of it. The piece is
// capped, so no line can make the pattern backtrack for long.
const OVERPRINT = /(\p{L}{2,12}?)\1{3,}/gu;

export function collapseOverprint(line: string) {
  return line.replace(OVERPRINT, '$1');
}

// Outline titles by page, so a heading line at the top of a page is never taken for a
// running head.
export type PageHeading = { page: number; title: string };

/**
 * Cleans the text of each page: drops running headers, footers and page numbers, rejoins
 * words hyphenated across lines, and tidies whitespace. Line breaks are otherwise kept, so
 * code and tables in books stay readable. Pages never merge: the result has one entry per
 * input page and no form feeds, which mark page boundaries later on.
 */
export function cleanPages(pages: string[], headings: PageHeading[] = []) {
  const lines = pages.map((page) =>
    page
      // Postgres text can't hold NUL; \f marks page boundaries later on.
      .replace(/[\0\f]/g, '')
      .split('\n')
      // A hyphen inside a line is a plain hyphen, whichever character the PDF used.
      .map((line) => collapseOverprint(line.trimEnd().replace(/\u2010(?=.)/g, '-'))),
  );
  const cleaned = removeRunningHeads(lines, headings).map((pageLines) =>
    pageLines.join('\n').trim(),
  );
  const vocabulary = vocabularyOf(cleaned);
  return carryWordsAcrossPages(cleaned, vocabulary).map((page) =>
    page
      .replace(LINE_BREAK_HYPHEN, (_, left: string, hyphen: string, right: string) =>
        mendWord(left, hyphen, right, vocabulary),
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

/** False when most pages have no text, as in a scanned book without an OCR layer. */
export function hasTextLayer(pages: string[]) {
  const { minPageChars, maxEmptyPageShare } = appConfig.ingestion.pdf;
  if (pages.length === 0) return false;
  const empty = pages.filter((page) => page.replace(/\s/g, '').length < minPageChars).length;
  return empty / pages.length < maxEmptyPageShare;
}

// Only a page's first and last lines can be a header or footer.
function removeRunningHeads(pages: string[][], headings: PageHeading[]) {
  const edges = pages.map(edgeIndexes);
  const titlesByPage = new Map<number, string[]>();
  for (const { page, title } of headings) {
    titlesByPage.set(page, [...(titlesByPage.get(page) ?? []), squash(title)]);
  }
  const isHeading = (line: string, page: number) => {
    const text = squash(line);
    return (
      CHAPTER_LINE.test(line) ||
      (text.length >= 3 && (titlesByPage.get(page) ?? []).some((title) => title.startsWith(text)))
    );
  };

  const repeats = new Map<string, number>();
  pages.forEach((lines, p) => {
    const keys = new Set(edges[p]!.map((i) => headKey(lines[i]!)));
    for (const key of keys) repeats.set(key, (repeats.get(key) ?? 0) + 1);
  });

  return pages.map((lines, p) => {
    const drop = new Set(
      edges[p]!.filter((i) => {
        const line = lines[i]!.trim();
        const key = headKey(line);
        if (isHeading(line, p + 1)) return false;
        return (
          BARE_PAGE_NUMBER.test(line) ||
          NUMBERED_HEAD.test(line) ||
          (key.includes('#') &&
            line.length <= MAX_HEAD_LENGTH &&
            (repeats.get(key) ?? 0) >= MIN_REPEATS)
        );
      }),
    );
    return lines.filter((_, i) => !drop.has(i));
  });
}

function edgeIndexes(lines: string[]) {
  const filled = lines.flatMap((line, i) => (line.trim() ? [i] : []));
  return [...new Set([filled[0], filled.at(-1)].filter((i) => i !== undefined))];
}

// The same running head on different pages differs only in its numbers.
function headKey(line: string) {
  return line
    .trim()
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/^[ivxlcdm]+(?=\s*\|)|(?<=\|\s*)[ivxlcdm]+$/g, '#');
}

// Letters and digits only, for comparing titles with page lines.
export function squash(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

type Vocabulary = { words: Set<string>; compounds: Set<string> };

function vocabularyOf(pages: string[]): Vocabulary {
  const words = new Set<string>();
  const compounds = new Set<string>();
  for (const page of pages) {
    const text = page.toLowerCase();
    for (const [word] of text.matchAll(/[a-z]{2,}/g)) words.add(word);
    for (const [compound] of text.matchAll(/[a-z]+-[a-z]+/g)) compounds.add(compound);
  }
  return { words, compounds };
}

const HYPHENS = '-\u2010\u00ad';
// The second part may start in uppercase: "Java-\nScript", "Zoo-\nKeeper".
const LINE_BREAK_HYPHEN = new RegExp(`([A-Za-z]+)([${HYPHENS}])\\n([A-Za-z]+)`, 'g');
const PAGE_END_FRAGMENT = new RegExp(`(?:^|\\s)([A-Za-z]+)([${HYPHENS}])$`);

// A word broken over two lines. Typesetters break words with the hyphen character U+2010
// or a soft hyphen; a plain "-" at a line end is usually the author's own, as in
// "data-intensive". The rest of the document decides: a typeset break is joined unless the
// hyphenated form appears elsewhere, a plain "-" is dropped only if the joined word does.
function mendWord(left: string, hyphen: string, right: string, { words, compounds }: Vocabulary) {
  const joined = `${left}${right}`;
  const compound = `${left}-${right}`;
  const keepHyphen =
    hyphen === '-' ? !words.has(joined.toLowerCase()) : compounds.has(compound.toLowerCase());
  return keepHyphen ? compound : joined;
}

// Footnotes in books are often marked "ii." or "iv." and can start a page.
const FOOTNOTE_MARK = /^[ivxlcdm]+\.\s/;

// A word split across a page break moves whole to the start of the next page, so pages stay
// where they are. Only when that page carries on in lowercase (not a heading or footnote).
function carryWordsAcrossPages(pages: string[], vocabulary: Vocabulary) {
  const result = [...pages];
  for (let i = 0; i < result.length - 1; i++) {
    const end = PAGE_END_FRAGMENT.exec(result[i]!);
    const start = FOOTNOTE_MARK.test(result[i + 1]!) ? null : /^[a-z]+/.exec(result[i + 1]!);
    if (!end || !start) continue;
    const [, left, hyphen] = end;
    result[i] = result[i]!.slice(0, result[i]!.length - left!.length - 1).trimEnd();
    result[i + 1] =
      mendWord(left!, hyphen!, start[0], vocabulary) + result[i + 1]!.slice(start[0].length);
  }
  return result;
}
