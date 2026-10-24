import { describe, expect, it } from 'vitest';
import type { ChunkPlan, ChunkSpan } from '../ingestion.types.js';
import { countLines, lineStarts, withLines } from './lines.js';
import { fileOutline } from './outline.js';

describe('countLines', () => {
  it('counts lines the way GitHub does', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\n\nb\n')).toBe(3);
  });
});

describe('lineStarts', () => {
  it('lists the offset where each line starts', () => {
    expect(lineStarts('ab\ncd\n')).toEqual([0, 3, 6]);
  });
});

function span(start: number, end: number, headingPath: string[]): ChunkSpan {
  return {
    start,
    end,
    headingPath,
    pageStart: 4,
    pageEnd: 4,
    lineStart: null,
    lineEnd: null,
    symbolName: null,
    tokenCount: 1,
  };
}

describe('withLines', () => {
  const text = 'one\ntwo\nthree\n';

  it('sets 1-based inclusive line ranges and clears pages', () => {
    const plan: ChunkPlan = {
      parents: [span(0, text.length, ['f'])],
      children: [
        { ...span(0, 3, ['f']), parentIndex: 0 },
        { ...span(4, 13, ['f']), parentIndex: 0 },
      ],
    };
    const result = withLines(text, plan);
    expect(result.parents[0]).toMatchObject({ lineStart: 1, lineEnd: 3, pageStart: null });
    expect(result.children.map((c) => [c.lineStart, c.lineEnd])).toEqual([
      [1, 1],
      [2, 3],
    ]);
    expect(result.children.every((c) => c.pageStart === null && c.pageEnd === null)).toBe(true);
  });
});

describe('fileOutline', () => {
  const plan: ChunkPlan = {
    parents: [span(0, 10, ['src/a.ts', 'class A'])],
    children: [
      { ...span(0, 5, ['src/a.ts', 'class A', 'run']), parentIndex: 0 },
      { ...span(5, 10, ['src/a.ts']), parentIndex: 0 },
    ],
  };

  it('lists imports and defined names', () => {
    const text = [
      "import { x } from './x';",
      "export * from './y';",
      "const fs = require('fs');",
      'from os import path',
      'const notImport = 1;',
      "  import indented from 'z';",
    ].join('\n');
    expect(fileOutline(text, plan).split('\n')).toEqual([
      "import { x } from './x';",
      "export * from './y';",
      "const fs = require('fs');",
      'from os import path',
      'defines: class A',
      'defines: class A > run',
    ]);
  });

  it('stays under its token cap', () => {
    const text = Array.from({ length: 100 }, (_, i) => `import m${i} from './module${i}';`).join(
      '\n',
    );
    const outline = fileOutline(text, plan, 50);
    expect(outline.length).toBeGreaterThan(0);
    expect(outline.split('\n').length).toBeLessThan(100);
    expect(outline.split('\n').length).toBeLessThanOrEqual(10);
  });
});
