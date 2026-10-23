import { describe, expect, it } from 'vitest';
import { buildPdf, minimalPdf } from '../../../tests/helpers/pdf.js';
import { PdfReadError, readPdf } from './pdf/pdf.parser.js';
import { buildToc, findTitle, outlineHeadings } from './toc.js';

const pages = [
  'Hashing Handbook\nA short book.',
  'CHAPTER 1\nHash Tables\nA hash table maps keys to buckets.',
  'More about buckets.\n1.1 Collisions\nTwo keys can share a bucket.',
  'CHAPTER 2\nTrees\nTrees keep keys in order.',
];

describe('readPdf', () => {
  it('reads the text of each page and resolves outline items to pages', async () => {
    const pdf = buildPdf({
      pages,
      outline: [
        {
          title: 'Chapter 1. Hash Tables',
          page: 2,
          items: [{ title: '1.1 Collisions', page: 3 }],
        },
        { title: 'Chapter 2. Trees', page: 4 },
      ],
    });
    const raw = await readPdf(pdf);

    expect(raw.pages).toHaveLength(4);
    expect(raw.pages[2]).toContain('Two keys can share a bucket.');
    expect(raw.outline).toEqual([
      {
        title: 'Chapter 1. Hash Tables',
        page: 2,
        items: [{ title: '1.1 Collisions', page: 3, items: [] }],
      },
      { title: 'Chapter 2. Trees', page: 4, items: [] },
    ]);
  });

  it('rejects bytes pdf.js cannot open with a message for the user', async () => {
    const broken = Buffer.from('%PDF-1.7\nthis is not really a pdf');
    await expect(readPdf(broken)).rejects.toThrow(new PdfReadError('Could not read this PDF'));
  });

  it('reads a PDF without text as empty pages', async () => {
    expect((await readPdf(minimalPdf())).pages).toEqual(['']);
  });
});

describe('buildToc', () => {
  const outline = outlineHeadings([
    {
      title: 'Chapter 1. Hash Tables',
      page: 2,
      items: [{ title: '1.1 Collisions', page: 3, items: [] }],
    },
    { title: 'Chapter 2. Trees', page: 4, items: [] },
    { title: 'Website', page: null, items: [] },
  ]);
  const content = pages.join('\f');

  it('starts each section at its title, even mid-page, and nests by level', () => {
    const toc = buildToc(pages, outline);

    expect(
      toc.map(({ title, level, parentIndex, number }) => ({ title, level, parentIndex, number })),
    ).toEqual([
      { title: 'Chapter 1. Hash Tables', level: 1, parentIndex: null, number: '1' },
      { title: '1.1 Collisions', level: 2, parentIndex: 0, number: '1.1' },
      { title: 'Chapter 2. Trees', level: 1, parentIndex: null, number: '2' },
    ]);
    const [chapter1, collisions, chapter2] = toc;
    expect(content.slice(collisions!.charStart)).toMatch(/^1\.1 Collisions\n/);
    expect(content.slice(chapter2!.charStart)).toMatch(/^CHAPTER 2\nTrees/);
    // A chapter covers its subsections and runs up to the next chapter.
    expect(chapter1).toMatchObject({ charEnd: chapter2!.charStart, pageStart: 2, pageEnd: 3 });
    expect(collisions).toMatchObject({ charEnd: chapter2!.charStart, pageStart: 3, pageEnd: 3 });
    expect(chapter2).toMatchObject({ charEnd: content.length, pageStart: 4, pageEnd: 4 });
  });

  it('starts a section at its page when the title is not on it', () => {
    const toc = buildToc(pages, [{ title: 'Something else', level: 1, page: 3 }]);
    expect(toc[0]).toMatchObject({ charStart: content.indexOf('More about'), pageStart: 3 });
  });

  it('finds numbered headings when there is no outline', () => {
    const plain = [
      'Intro text.',
      '1 Basics\nSome text.\n1.2 Details\nMore text.',
      '2 Advanced Topics\nThe end. 3 apples is not a heading.',
    ];
    const toc = buildToc(plain, []);
    expect(toc.map(({ title, level, parentIndex }) => ({ title, level, parentIndex }))).toEqual([
      { title: '1 Basics', level: 1, parentIndex: null },
      { title: '1.2 Details', level: 2, parentIndex: 0 },
      { title: '2 Advanced Topics', level: 1, parentIndex: null },
    ]);
  });

  it('falls back to one node for the whole document', () => {
    const toc = buildToc(['Just text.', 'More text.'], []);
    expect(toc).toEqual([
      {
        title: 'Document',
        number: null,
        level: 1,
        parentIndex: null,
        charStart: 0,
        charEnd: 'Just text.\fMore text.'.length,
        pageStart: 1,
        pageEnd: 2,
      },
    ]);
  });
});

describe('findTitle', () => {
  it('matches a title wrapped over several lines, ignoring case and punctuation', () => {
    const text = 'intro\nCHAPTER 7\nReliable, Scalable and\nMaintainable Apps\nbody';
    expect(findTitle(text, 'Chapter 7. Reliable, Scalable and Maintainable Apps')).toBe(
      'intro\n'.length,
    );
    expect(findTitle(text, 'Nowhere')).toBe(-1);
  });
});
