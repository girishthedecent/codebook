import { describe, expect, it } from 'vitest';
import { comparableUrl, hitsRef, refHits, type MatchableChunk } from './matching.js';

const chunk = (fields: Partial<MatchableChunk>): MatchableChunk => ({
  sourceKey: 'book',
  documentPath: 'book.pdf',
  headingPath: [],
  pageStart: null,
  pageEnd: null,
  lineStart: null,
  lineEnd: null,
  ...fields,
});

describe('book refs', () => {
  const ref = { sourceKey: 'book', pageStart: 10, pageEnd: 12 } as const;

  it('hits when the page ranges overlap, touching ends included', () => {
    expect(hitsRef(chunk({ pageStart: 11, pageEnd: 11 }), ref)).toBe(true);
    expect(hitsRef(chunk({ pageStart: 8, pageEnd: 10 }), ref)).toBe(true);
    expect(hitsRef(chunk({ pageStart: 12, pageEnd: 14 }), ref)).toBe(true);
    expect(hitsRef(chunk({ pageStart: 5, pageEnd: 20 }), ref)).toBe(true);
  });

  it('misses next to the range, without pages, or from another source', () => {
    expect(hitsRef(chunk({ pageStart: 13, pageEnd: 14 }), ref)).toBe(false);
    expect(hitsRef(chunk({ pageStart: 8, pageEnd: 9 }), ref)).toBe(false);
    expect(hitsRef(chunk({}), ref)).toBe(false);
    expect(hitsRef(chunk({ sourceKey: 'repo', pageStart: 11, pageEnd: 11 }), ref)).toBe(false);
    expect(hitsRef(chunk({ sourceKey: null, pageStart: 11, pageEnd: 11 }), ref)).toBe(false);
  });

  it('treats a missing end page as a one-page chunk', () => {
    expect(hitsRef(chunk({ pageStart: 12 }), ref)).toBe(true);
    expect(hitsRef(chunk({ pageStart: 13 }), ref)).toBe(false);
  });
});

describe('repo refs', () => {
  const ref = {
    sourceKey: 'repo',
    path: 'lib/router/index.js',
    lineStart: 40,
    lineEnd: 60,
  } as const;
  const code = (fields: Partial<MatchableChunk>) =>
    chunk({ sourceKey: 'repo', documentPath: 'lib/router/index.js', ...fields });

  it('hits the same file when the line ranges overlap', () => {
    expect(hitsRef(code({ lineStart: 55, lineEnd: 90 }), ref)).toBe(true);
    expect(hitsRef(code({ lineStart: 1, lineEnd: 40 }), ref)).toBe(true);
    expect(
      hitsRef(code({ documentPath: './lib/router/index.js', lineStart: 45, lineEnd: 50 }), ref),
    ).toBe(true);
  });

  it('misses another file or lines outside the range', () => {
    expect(
      hitsRef(code({ documentPath: 'lib/router/route.js', lineStart: 45, lineEnd: 50 }), ref),
    ).toBe(false);
    expect(hitsRef(code({ lineStart: 61, lineEnd: 80 }), ref)).toBe(false);
    expect(hitsRef(code({}), ref)).toBe(false);
  });
});

describe('docs refs', () => {
  const page = (fields: Partial<MatchableChunk>) =>
    chunk({
      sourceKey: 'docs',
      documentPath: 'https://expressjs.com/en/guide/routing/',
      headingPath: ['Routing', 'Route parameters'],
      ...fields,
    });

  it('matches the URL with or without a trailing slash and fragment', () => {
    expect(
      hitsRef(page({}), { sourceKey: 'docs', url: 'https://expressjs.com/en/guide/routing' }),
    ).toBe(true);
    expect(
      hitsRef(page({}), {
        sourceKey: 'docs',
        url: 'https://expressjs.com/en/guide/routing/#params',
      }),
    ).toBe(true);
    expect(hitsRef(page({}), { sourceKey: 'docs', url: 'https://expressjs.com/en/guide/' })).toBe(
      false,
    );
  });

  it('needs the heading in the chunk path when the ref names one, ignoring case', () => {
    const url = 'https://expressjs.com/en/guide/routing/';
    expect(hitsRef(page({}), { sourceKey: 'docs', url, heading: 'route PARAMETERS' })).toBe(true);
    expect(hitsRef(page({}), { sourceKey: 'docs', url, heading: 'Route handlers' })).toBe(false);
  });

  it('keeps the root path and drops tracking parameters', () => {
    expect(comparableUrl('https://example.com/')).toBe('https://example.com/');
    expect(comparableUrl('https://example.com/a/?utm_source=x')).toBe('https://example.com/a');
    expect(comparableUrl('mailto:someone@example.com')).toBeNull();
  });
});

it('lists the refs each ranked chunk hits', () => {
  const refs = [
    { sourceKey: 'book', pageStart: 1, pageEnd: 2 },
    { sourceKey: 'book', pageStart: 2, pageEnd: 3 },
  ] as const;
  expect(
    refHits([chunk({ pageStart: 2, pageEnd: 2 }), chunk({ pageStart: 9, pageEnd: 9 })], [...refs]),
  ).toEqual([[0, 1], []]);
});
