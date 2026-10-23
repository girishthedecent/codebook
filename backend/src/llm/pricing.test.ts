import { describe, expect, it } from 'vitest';
import { estimateCost } from './pricing.js';
import { embeddingRoute, textRoutes } from './models.js';

describe('estimateCost', () => {
  it('prices input and output per million tokens', () => {
    // 1M in at $0.15 + 0.5M out at $0.60
    const cost = estimateCost('openai/gpt-oss-120b', {
      tokensIn: 1_000_000,
      tokensOut: 500_000,
      tokensCached: 0,
    });
    expect(cost.toString()).toBe('0.45');
  });

  it('bills cached input at the cached rate where there is one', () => {
    // 900K uncached at $0.75 + 100K cached at $0.075
    const cost = estimateCost('gemini-3.6-flash', {
      tokensIn: 1_000_000,
      tokensOut: 0,
      tokensCached: 100_000,
    });
    expect(cost.toString()).toBe('0.6825');
  });

  it('keeps fractions of a cent exact', () => {
    const cost = estimateCost('openai/gpt-oss-20b', {
      tokensIn: 73,
      tokensOut: 16,
      tokensCached: 0,
    });
    expect(cost.toString()).toBe('0.000010275');
  });

  it('returns 0 for a model without a price', () => {
    expect(
      estimateCost('unknown/model', { tokensIn: 10, tokensOut: 10, tokensCached: 0 }).isZero(),
    ).toBe(true);
  });

  it('has a price for every routed model', () => {
    const routed = Object.values(textRoutes).flatMap(({ primary, fallback }) =>
      fallback ? [primary, fallback] : [primary],
    );
    for (const { model } of [...routed, embeddingRoute.model]) {
      expect(
        estimateCost(model, { tokensIn: 1_000, tokensOut: 1_000, tokensCached: 0 }).isZero(),
      ).toBe(false);
    }
  });
});
