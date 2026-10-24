import { describe, expect, it } from 'vitest';
import { bestScores, rrf } from './fusion.js';

const list = (...ids: string[]) => ids.map((id, i) => ({ id, score: 1 - i / 10 }));

describe('rrf', () => {
  it('ranks an id found by both lists above ids found by one', () => {
    const fused = rrf([list('a', 'b', 'c'), list('c', 'd')], 60);

    expect(fused.map((item) => item.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(fused[0]!.rrf).toBeCloseTo(1 / 63 + 1 / 61);
    expect(fused[1]!.rrf).toBeCloseTo(1 / 61);
  });

  it('keeps the order of the one list that found anything', () => {
    expect(rrf([list('x', 'y'), []], 60).map((item) => item.id)).toEqual(['x', 'y']);
    expect(rrf([], 60)).toEqual([]);
  });

  it('breaks ties by vector score, then by id', () => {
    // a and b are both first in one list; c and d both second in one list.
    const lists = [list('a', 'c'), list('b', 'd')];

    expect(rrf(lists, 60).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    const vectorScores = new Map([
      ['b', 0.9],
      ['a', 0.4],
      ['d', 0.2],
    ]);
    // c has no vector score, so d goes first among the second places.
    expect(rrf(lists, 60, vectorScores).map((item) => item.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('uses k to flatten the rank differences', () => {
    const [first, second] = rrf([list('a', 'b')], 1);
    expect(first!.rrf).toBeCloseTo(1 / 2);
    expect(second!.rrf).toBeCloseTo(1 / 3);
  });

  it('weighs each list by its weight', () => {
    // Without weights the tie goes to the vector score; a lighter second list loses it.
    const lists = [list('a'), list('b')];
    expect(rrf(lists, 60, new Map([['b', 0.9]])).map((item) => item.id)).toEqual(['b', 'a']);
    expect(rrf(lists, 60, new Map([['b', 0.9]]), [1, 0.5]).map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
    expect(rrf(lists, 60, new Map(), [1, 0.5])[1]!.rrf).toBeCloseTo(0.5 / 61);
  });
});

describe('bestScores', () => {
  it('keeps the highest score each id got in any list', () => {
    const scores = bestScores([
      [
        { id: 'a', score: 0.2 },
        { id: 'b', score: 0.7 },
      ],
      [{ id: 'a', score: 0.5 }],
      [],
    ]);

    expect(scores).toEqual(
      new Map([
        ['a', 0.5],
        ['b', 0.7],
      ]),
    );
  });
});
