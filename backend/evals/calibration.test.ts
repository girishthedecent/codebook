import { describe, expect, it } from 'vitest';
import { agreement, sampleLabels, type Label } from './calibration.js';

const candidate = (id: string, judgeSupported: boolean) => ({
  id,
  runId: 'run',
  caseId: 'case',
  claim: `claim ${id}`,
  judgeSupported,
  cited: [],
});

describe('sampleLabels', () => {
  it('takes half supported and half unsupported verdicts when there are enough', () => {
    const candidates = [
      ...Array.from({ length: 30 }, (_, i) => candidate(`yes-${i}`, true)),
      ...Array.from({ length: 30 }, (_, i) => candidate(`no-${i}`, false)),
    ];
    const sample = sampleLabels(candidates, 20);
    expect(sample).toHaveLength(20);
    expect(sample.filter((item) => item.judgeSupported)).toHaveLength(10);
    expect(sample.every((item) => item.human === null && item.note === '')).toBe(true);
    // The same runs give the same sample.
    expect(sampleLabels([...candidates].reverse(), 20)).toEqual(sample);
  });

  it('fills up from the other side when one side is short', () => {
    const candidates = [
      ...Array.from({ length: 30 }, (_, i) => candidate(`yes-${i}`, true)),
      candidate('no-1', false),
    ];
    const sample = sampleLabels(candidates, 20);
    expect(sample).toHaveLength(20);
    expect(sample.filter((item) => !item.judgeSupported)).toHaveLength(1);
  });
});

describe('agreement', () => {
  it('counts only labelled claims and both kinds of disagreement', () => {
    const label = (judgeSupported: boolean, human: boolean | null): Label => ({
      ...candidate('x', judgeSupported),
      human,
      note: '',
    });
    expect(
      agreement([
        label(true, true),
        label(true, false),
        label(false, true),
        label(false, false),
        label(true, null),
      ]),
    ).toEqual({ labelled: 4, agree: 2, rate: 0.5, falseSupported: 1, falseUnsupported: 1 });
    expect(agreement([label(true, null)]).rate).toBeNull();
  });
});
