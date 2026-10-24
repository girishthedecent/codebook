import { describe, expect, it } from 'vitest';
import { countTokens } from './tokens.js';

describe('countTokens', () => {
  it('counts ordinary text exactly', () => {
    expect(countTokens('Hello world')).toBe(2);
    expect(countTokens('')).toBe(0);
  });

  it('stays fast and close on long runs of one kind of character', () => {
    const started = performance.now();
    const letters = countTokens(`start ${'a'.repeat(400_000)} end`);
    const newlines = countTokens('\n'.repeat(400_000));
    const symbols = countTokens('='.repeat(400_000));
    // Letters with combining marks are one tokenizer piece too (á as a + U+0301).
    const marked = countTokens('a\u0301'.repeat(200_000));
    expect(performance.now() - started).toBeLessThan(3_000);
    // Exact counts would take hours; the estimate scales with the run.
    expect(letters).toBeGreaterThan(400_000 / 32);
    expect(newlines).toBeGreaterThan(0);
    expect(symbols).toBeGreaterThan(0);
    expect(marked).toBeGreaterThan(0);
    expect(countTokens('a'.repeat(1_000))).toBeLessThan(countTokens('a'.repeat(2_000)));
  });
});
