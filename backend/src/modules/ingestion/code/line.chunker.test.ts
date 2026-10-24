import { describe, expect, it } from 'vitest';
import type { ChunkSettings } from '../doc.chunker.js';
import { chunkLines } from './line.chunker.js';

const settings: ChunkSettings = {
  parentMaxTokens: 120,
  childTokens: 40,
  overlapTokens: 12,
  minSectionTokens: 5,
};

const lines = Array.from({ length: 60 }, (_, i) => `const value${i} = compute(${i});`);
const text = lines.join('\n');

describe('chunkLines', () => {
  const plan = chunkLines(text, 'src/data.js', settings);

  it('returns no chunks for empty text', () => {
    expect(chunkLines('', 'a.js', settings)).toEqual({ parents: [], children: [] });
  });

  it('keeps children near the child size and parents within theirs', () => {
    expect(plan.children.length).toBeGreaterThan(3);
    for (const child of plan.children) {
      expect(child.tokenCount).toBeLessThanOrEqual(
        settings.childTokens + settings.minSectionTokens,
      );
    }
    for (const parent of plan.parents) {
      expect(parent.tokenCount).toBeLessThanOrEqual(settings.parentMaxTokens);
    }
  });

  it('overlaps consecutive children by whole lines', () => {
    const overlapping = plan.children.filter(
      (child, i) => i > 0 && child.lineStart! <= plan.children[i - 1]!.lineEnd!,
    );
    expect(overlapping.length).toBeGreaterThan(0);
    for (const child of plan.children) {
      expect(text[child.start - 1] === undefined || text[child.start - 1] === '\n').toBe(true);
    }
  });

  it('uses the path as heading path and leaves pages and symbol empty', () => {
    for (const chunk of [...plan.parents, ...plan.children]) {
      expect(chunk.headingPath).toEqual(['src/data.js']);
      expect(chunk.pageStart).toBeNull();
      expect(chunk.pageEnd).toBeNull();
      expect(chunk.symbolName).toBeNull();
    }
  });

  it('gives exact line ranges and keeps children inside their parent', () => {
    const all = text.split('\n');
    for (const chunk of [...plan.parents, ...plan.children]) {
      const covered = all.slice(chunk.lineStart! - 1, chunk.lineEnd!).join('\n');
      expect(covered).toContain(text.slice(chunk.start, chunk.end));
    }
    for (const child of plan.children) {
      const parent = plan.parents[child.parentIndex]!;
      expect(child.start).toBeGreaterThanOrEqual(parent.start);
      expect(child.end).toBeLessThanOrEqual(parent.end);
    }
    expect(plan.children[0]!.lineStart).toBe(1);
    expect(plan.children.at(-1)!.lineEnd).toBe(60);
  });
});
