import { describe, expect, it } from 'vitest';
import { countTokens } from '../../utils/tokens.js';
import { chunkDocument, chunkText, type ChunkSettings } from './doc.chunker.js';
import type { TocEntry } from './ingestion.types.js';
import { buildToc } from './toc.js';

// Small sizes so a few sentences exercise every rule.
const settings: ChunkSettings = {
  parentMaxTokens: 120,
  childTokens: 40,
  overlapTokens: 12,
  minSectionTokens: 5,
};

const sentence = (n: number) => `Sentence number ${n} explains one small idea about hashing.`;
const sentences = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');

function entry(
  title: string,
  charStart: number,
  charEnd: number,
  level = 1,
  parentIndex: number | null = null,
): TocEntry {
  return {
    title,
    number: null,
    level,
    parentIndex,
    charStart,
    charEnd,
    pageStart: null,
    pageEnd: null,
  };
}

describe('chunkDocument', () => {
  const pages = [
    `Front matter. ${sentences(1, 3)}`,
    `Hashing\n${sentences(10, 12)}`,
    `${sentences(30, 10)}`,
  ];
  const content = pages.join('\f');
  const hashingStart = content.indexOf('Hashing');
  const toc = [entry('Hashing', hashingStart, content.length)];
  const plan = chunkDocument(content, toc, settings);
  const textOf = (chunk: { start: number; end: number }) =>
    chunkText(content, chunk.start, chunk.end);

  it('keeps children and parents within their sizes', () => {
    for (const child of plan.children) {
      expect(child.tokenCount).toBeLessThanOrEqual(
        settings.childTokens + settings.minSectionTokens,
      );
    }
    for (const parent of plan.parents) {
      expect(parent.tokenCount).toBeLessThanOrEqual(settings.parentMaxTokens);
    }
    expect(plan.parents.length).toBeGreaterThan(2);
  });

  it('cuts only between whole sentences and overlaps neighbours by whole sentences', () => {
    const children = plan.children.filter((child) => child.parentIndex === 1);
    expect(children.length).toBeGreaterThan(1);
    // The first one also carries the section's heading line.
    for (const child of children)
      expect(textOf(child)).toMatch(/^(Hashing\n)?Sentence number \d+ .*hashing\.$/s);
    for (let i = 1; i < children.length; i++) {
      // The next child starts before the previous one ends.
      expect(children[i]!.start).toBeLessThan(children[i - 1]!.end);
      expect(children[i]!.start).toBeGreaterThan(children[i - 1]!.start);
    }
  });

  it('places every child inside its parent and covers the parent', () => {
    plan.parents.forEach((parent, index) => {
      const children = plan.children.filter((child) => child.parentIndex === index);
      expect(children[0]!.start).toBe(parent.start);
      expect(children.at(-1)!.end).toBe(parent.end);
      for (const child of children) {
        expect(child.start).toBeGreaterThanOrEqual(parent.start);
        expect(child.end).toBeLessThanOrEqual(parent.end);
      }
    });
  });

  it('gives text before the first heading its own section, and headings to the rest', () => {
    expect(plan.parents[0]!.headingPath).toEqual([]);
    expect(textOf(plan.parents[0]!)).toMatch(/^Front matter\./);
    expect(plan.parents.slice(1).every((parent) => parent.headingPath[0] === 'Hashing')).toBe(true);
  });

  it('maps chunks to pages, including across a page break', () => {
    expect(plan.parents[0]).toMatchObject({ pageStart: 1, pageEnd: 1 });
    const spanning = plan.children.find((child) => child.pageStart === 2 && child.pageEnd === 3);
    expect(spanning).toBeDefined();
    // Page breaks show as line breaks in chunk text.
    expect(textOf(spanning!)).not.toContain('\f');
    expect(plan.children.at(-1)).toMatchObject({ pageEnd: 3 });
  });

  it('counts tokens of the chunk text', () => {
    const child = plan.children[3]!;
    expect(child.tokenCount).toBe(countTokens(textOf(child)));
  });

  it('nests heading paths from the TOC tree', () => {
    const text = `Intro.\fCHAPTER 1\n${sentences(1, 3)}\f1.1 Details\n${sentences(5, 3)}`;
    const tocPages = text.split('\f');
    const tree = buildToc(tocPages, [
      { title: 'Chapter 1', level: 1, page: 2 },
      { title: '1.1 Details', level: 2, page: 3 },
    ]);
    const nested = chunkDocument(text, tree, settings);
    expect(nested.parents.at(-1)!.headingPath).toEqual(['Chapter 1', '1.1 Details']);
  });

  it('folds a tiny section into the next one', () => {
    const text = `Part II\f${sentences(1, 3)}`;
    const nested = chunkDocument(
      text,
      [entry('Part II', 0, text.length), entry('Chapter 5', text.indexOf('Sentence'), text.length)],
      settings,
    );
    expect(nested.parents).toHaveLength(1);
    expect(nested.parents[0]).toMatchObject({ start: 0, headingPath: ['Chapter 5'] });
  });

  it('never makes a child of overlap alone when a big unit follows', () => {
    // A long sentence, a short one, then a long one that fits a child but not next to the
    // short one: stepping back over the short sentence for overlap must not happen here.
    const sentenceOf = (word: string, count: number) =>
      `${Array.from({ length: count }, () => word).join(' ')}.`;
    const [first, short, last] = [
      sentenceOf('alpha', 30),
      'Short one here.',
      sentenceOf('Omega', 37),
    ];
    expect(countTokens(last)).toBeLessThanOrEqual(settings.childTokens);
    expect(countTokens(short) + countTokens(last)).toBeGreaterThan(settings.childTokens);

    const text = `${first} ${short} ${last}`;
    const result = chunkDocument(text, [], settings);
    expect(result.children.map((child) => chunkText(text, child.start, child.end))).toEqual([
      `${first} ${short}`,
      last,
    ]);
  });

  it('splits an over-long sentence at line breaks, then spaces, never inside a word', () => {
    const code = Array.from({ length: 30 }, (_, i) => `const value${i} = compute(${i})`).join('\n');
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const text = `${code}\n\n${words}`;
    const result = chunkDocument(text, [], settings);
    for (const child of result.children) {
      expect(child.tokenCount).toBeLessThanOrEqual(
        settings.childTokens + settings.minSectionTokens,
      );
      const piece = chunkText(text, child.start, child.end);
      expect(piece).toMatch(/^(const|word)/);
      expect(text[child.end] === undefined || /\s/.test(text[child.end]!)).toBe(true);
    }
  });
});
