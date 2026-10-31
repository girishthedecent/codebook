import { describe, expect, it } from 'vitest';
import { inlineDisposition } from './contentDisposition.js';

/** The name a client reading `filename*` would use. */
function decoded(header: string) {
  const [, encoded] = /filename\*=UTF-8''(\S+)$/.exec(header)!;
  return decodeURIComponent(encoded!);
}

describe('inlineDisposition', () => {
  it('keeps a plain name as it is, in both forms', () => {
    expect(inlineDisposition('book.pdf')).toBe(
      `inline; filename="book.pdf"; filename*=UTF-8''book.pdf`,
    );
  });

  it.each([
    ['Cyrillic', 'Глубокое обучение.pdf', '________ ________.pdf'],
    ['CJK', '深度学习小书.pdf', '______.pdf'],
    ['an emoji', 'notes 📚.pdf', 'notes _.pdf'],
    ['accents', 'Café.pdf', 'Caf_.pdf'],
  ])('writes %s as UTF-8 and falls back to ASCII', (_, name, fallback) => {
    const header = inlineDisposition(name);

    expect(header).toBe(
      `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    expect(decoded(header)).toBe(name);
    // Node refuses any other character in a header value.
    expect(header).toMatch(/^[\x20-\x7e]+$/);
  });

  it('encodes what RFC 5987 does not allow in a value, and what could end the quoted name', () => {
    const name = `it's (a) *"draft"*\\50%.pdf`;
    const header = inlineDisposition(name);

    expect(header).toContain(`filename="it's (a) *_draft_*_50_.pdf"`);
    expect(header).toContain(`filename*=UTF-8''it%27s%20%28a%29%20%2A%22draft%22%2A%5C50%25.pdf`);
    expect(decoded(header)).toBe(name);
  });

  it('cannot be split into a second header by a line break in the name', () => {
    const header = inlineDisposition('a\r\nSet-Cookie: x=1.pdf');

    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="a__Set-Cookie: x=1.pdf"');
  });

  it('names a file with no name', () => {
    expect(inlineDisposition('  ')).toBe(
      `inline; filename="document.pdf"; filename*=UTF-8''document.pdf`,
    );
  });
});
