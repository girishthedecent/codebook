import { describe, expect, it } from 'vitest';
import { cleanPages, collapseOverprint, hasTextLayer } from './pdf.text.js';

// Builds pages whose body lines differ, so only the given header/footer lines repeat.
function book(pageCount: number, header: (n: number) => string, footer: (n: number) => string) {
  return Array.from({ length: pageCount }, (_, i) =>
    [
      header(i + 1),
      `Body text of page ${i + 1} about topic ${'abcdefghij'[i]}.`,
      footer(i + 1),
    ].join('\n'),
  );
}

describe('collapseOverprint', () => {
  it('restores words drawn as many overlapping copies', () => {
    // As the text layer of a real book's chapter openings reads.
    const garbled =
      'DeepDeepDeepDeepDeepDeepDeepDeepDeepDeepDeep ' +
      'learnlearnlearnlearnlearnlearnlearnlearnlearnlearnlearninginginginginginginginginginging ' +
      'belongs to statistical mamamamamamamamamamamachinechinechinechinechinechinechinechinechinechinechine ' +
      'learnlearnlearnlearninginginginging';
    expect(collapseOverprint(garbled)).toBe(
      'Deep learning belongs to statistical machine learning',
    );
  });

  it('leaves ordinary text, numbers and separators alone', () => {
    const text =
      'Mississippi bookkeeper tomorrow banana cannonball hahaha 1000000 ha ha ha ha ------ == ===';
    expect(collapseOverprint(text)).toBe(text);
  });

  it('takes no time on a line of letters nobody repeats', () => {
    const line = 'abcdefghijklmnopqrstuvwxyz'.repeat(40_000);
    const started = performance.now();
    expect(collapseOverprint(line)).toBe(line);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('runs on every page of a book', () => {
    expect(cleanPages(['DeepDeepDeepDeep learning', 'plain page'])).toEqual([
      'Deep learning',
      'plain page',
    ]);
  });
});

describe('cleanPages', () => {
  it('drops running heads that only change their page number', () => {
    const pages = book(
      5,
      () => 'Designing Systems',
      (n) => `Page ${n} of the book`,
    );
    const cleaned = cleanPages(pages);
    expect(cleaned).toHaveLength(5);
    for (const page of cleaned) expect(page).not.toMatch(/Page \d+ of the book/);
    // A header without a number isn't a page furniture pattern we can be sure of.
    expect(cleaned[0]).toContain('Designing Systems');
  });

  it('drops bare page numbers and "number | title" heads even when they rarely repeat', () => {
    const cleaned = cleanPages([
      'Intro line\nFirst page body.\n12',
      '14 | Chapter 2: Data Models\nSecond page body.\nxiv',
      'Third page body.\nReplication | 15',
    ]);
    expect(cleaned).toEqual([
      'Intro line\nFirst page body.',
      'Second page body.',
      'Third page body.',
    ]);
  });

  it('keeps long lines that repeat with different numbers, like a template sentence', () => {
    const body = (n: number) =>
      `In step ${n} the system writes ${n} records to the log, then reads every one of them back again in the order they were written.`;
    const cleaned = cleanPages([1, 2, 3].map((n) => `Heading ${n}\n${body(n)}`));
    cleaned.forEach((page, i) => expect(page).toContain(body(i + 1)));
  });

  it('only looks at the first and last lines of a page', () => {
    const cleaned = cleanPages(['Top line\n42\nBottom line']);
    expect(cleaned).toEqual(['Top line\n42\nBottom line']);
  });

  it('keeps chapter openers and outline titles that look like running heads', () => {
    const pages = book(
      4,
      (n) => `CHAPTER ${n}`,
      () => 'end',
    );
    const cleaned = cleanPages(pages, [{ page: 2, title: 'Chapter 2. Storage' }]);
    cleaned.forEach((page, i) => expect(page.startsWith(`CHAPTER ${i + 1}`)).toBe(true));

    const titled = cleanPages(
      ['Storage 1\nbody one.', 'Storage 2\nbody two.', 'Storage 3\nbody three.'],
      [{ page: 3, title: 'Storage 3 and Retrieval' }],
    );
    expect(titled).toEqual(['body one.', 'body two.', 'Storage 3\nbody three.']);
  });

  it('joins words the typesetter broke over a line, unless the document hyphenates them', () => {
    const [page] = cleanPages([
      'Data is dis\u2010\ntributed across nodes; leader-\nbased replication is common.\n' +
        'Some say multi\u2010\nleader, as in multi-leader setups. Java\u2010\nScript too.',
    ]);
    expect(page).toContain('distributed across');
    expect(page).toContain('multi-leader, as in');
    expect(page).toContain('JavaScript');
  });

  it("keeps an author's hyphen at a line end unless the joined word appears elsewhere", () => {
    const [page] = cleanPages([
      'A data-\nintensive app. We make recommen-\ndations, and recommendations matter.',
    ]);
    expect(page).toContain('data-intensive app');
    expect(page).toContain('make recommendations, and');
  });

  it('turns hyphen characters inside a line into plain hyphens', () => {
    expect(cleanPages(['read\u2010only replicas'])).toEqual(['read-only replicas']);
  });

  it('moves a word split across pages to the next page without merging the pages', () => {
    const cleaned = cleanPages([
      'First page ends with a dis\u2010',
      'tributed system on page two.',
      'Footnote page ends Elas\u2010',
      'ii. A footnote starts here.',
    ]);
    expect(cleaned).toEqual([
      'First page ends with a',
      'distributed system on page two.',
      'Footnote page ends Elas\u2010',
      'ii. A footnote starts here.',
    ]);
  });

  it('removes form feeds and NUL characters and collapses blank lines', () => {
    expect(cleanPages(['one\f\n\n\n\ntw\0o   \n'])).toEqual(['one\n\ntwo']);
  });

  it('keeps short words and code that only look like page numbers', () => {
    expect(cleanPages(['did\nbody text.\nmix'])).toEqual(['did\nbody text.\nmix']);
    expect(cleanPages(['c || d\nbody text.\nflags | xiv || y'])).toEqual([
      'c || d\nbody text.\nflags | xiv || y',
    ]);
  });
});

describe('hasTextLayer', () => {
  it('is false when nearly every page is empty, as in a scan', () => {
    const scanned = Array.from({ length: 20 }, () => '');
    scanned[0] = 'A cover page with a title on it.';
    expect(hasTextLayer(scanned)).toBe(false);
    expect(hasTextLayer([])).toBe(false);
  });

  it('is true when a book has some empty pages', () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      i % 3 === 0 ? '' : 'Real text on this page, long enough to count.',
    );
    expect(hasTextLayer(pages)).toBe(true);
  });
});
