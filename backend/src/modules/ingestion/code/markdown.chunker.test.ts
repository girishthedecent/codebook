import { describe, expect, it } from 'vitest';
import type { ChunkSettings } from '../doc.chunker.js';
import { chunkMarkdown, markdownHeadings } from './markdown.chunker.js';

const settings: ChunkSettings = {
  parentMaxTokens: 120,
  childTokens: 40,
  overlapTokens: 12,
  minSectionTokens: 5,
};

const sentence = (n: number) => `Sentence number ${n} explains one small idea about hashing.`;
const sentences = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');

describe('markdownHeadings', () => {
  it('ignores # lines inside fenced code blocks', () => {
    const text = [
      '# Title',
      '```sh',
      '# not a heading',
      '```',
      '~~~',
      '# nor this',
      '~~~',
      '## Real',
    ].join('\n');
    expect(markdownHeadings(text).map((e) => e.title)).toEqual(['Title', 'Real']);
  });

  it('nests levels and ends each entry at the next one at its level or above', () => {
    const text = '# A\ntext\n## B\ntext\n### C\ntext\n## D\ntext\n# E\ntext';
    const entries = markdownHeadings(text);
    expect(entries.map((e) => [e.title, e.level, e.parentIndex])).toEqual([
      ['A', 1, null],
      ['B', 2, 0],
      ['C', 3, 1],
      ['D', 2, 0],
      ['E', 1, null],
    ]);
    expect(entries[0]!.charEnd).toBe(text.indexOf('# E'));
    expect(entries[1]!.charEnd).toBe(text.indexOf('## D'));
    expect(entries[4]!.charEnd).toBe(text.length);
  });

  it('strips trailing hashes and needs a space after the marks', () => {
    expect(markdownHeadings('## Title ##\n#nospace').map((e) => e.title)).toEqual(['Title']);
  });

  it('reads a long line of hashes in linear time', () => {
    const line = '# a' + ' #'.repeat(200_000) + ' b';
    const started = performance.now();
    expect(markdownHeadings(line)[0]!.title.endsWith('# b')).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('chunkMarkdown', () => {
  const text = [
    '# Guide',
    sentences(1, 4),
    '## Setup',
    sentences(10, 10),
    '```sh',
    '# install it',
    '```',
    '## Usage',
    sentences(30, 10),
  ].join('\n');
  const plan = chunkMarkdown(text, 'docs/guide.md', settings);

  it('starts every heading path with the file path', () => {
    expect(plan.children.length).toBeGreaterThan(2);
    for (const chunk of [...plan.parents, ...plan.children]) {
      expect(chunk.headingPath[0]).toBe('docs/guide.md');
      expect(chunk.pageStart).toBeNull();
      expect(chunk.pageEnd).toBeNull();
    }
  });

  it('nests heading paths and never treats a fenced comment as a heading', () => {
    const paths = plan.children.map((c) => c.headingPath.join(' > '));
    expect(paths).toContain('docs/guide.md > Guide > Setup');
    expect(paths).toContain('docs/guide.md > Guide > Usage');
    expect(paths.some((p) => p.includes('install it'))).toBe(false);
  });

  it('gives exact line ranges', () => {
    const all = text.split('\n');
    for (const chunk of [...plan.parents, ...plan.children]) {
      const covered = all.slice(chunk.lineStart! - 1, chunk.lineEnd!).join('\n');
      expect(covered).toContain(text.slice(chunk.start, chunk.end));
    }
  });
});
