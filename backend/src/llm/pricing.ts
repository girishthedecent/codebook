import { Prisma } from '../generated/prisma/client.js';
import logger from '../config/logger.config.js';

// USD per 1M tokens, list prices from console.groq.com/docs/models and
// ai.google.dev/gemini-api/docs/pricing, checked 2026-10-23. We run on free tiers, so this
// is what the traffic would cost, for reporting and evals, not what we pay.
type Price = {
  input: number;
  output: number;
  // Groq doesn't list a cached price for these models, so cached tokens cost full input.
  cachedInput?: number;
};

const PRICES: Record<string, Price> = {
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
  // Goes up to $1.50 / $7.50 on 2027-01-01.
  'gemini-3.6-flash': { input: 0.75, output: 3.75, cachedInput: 0.075 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cachedInput: 0.03 },
  'gemini-embedding-2': { input: 0.2, output: 0 },
};

export type TokenCounts = {
  tokensIn: number;
  tokensOut: number;
  // Part of tokensIn that the provider served from its prompt cache.
  tokensCached: number;
};

const warned = new Set<string>();

/** List-price cost of one call. Reasoning tokens are part of tokensOut and billed as output. */
export function estimateCost(model: string, { tokensIn, tokensOut, tokensCached }: TokenCounts) {
  const price = PRICES[model];
  if (!price) {
    // An eval override can name any model; a missing price shouldn't fail the call.
    if (!warned.has(model)) {
      warned.add(model);
      logger.warn('No price for model, cost recorded as 0', { model });
    }
    return new Prisma.Decimal(0);
  }

  const uncached = new Prisma.Decimal(tokensIn - tokensCached).mul(price.input);
  const cached = new Prisma.Decimal(tokensCached).mul(price.cachedInput ?? price.input);
  const output = new Prisma.Decimal(tokensOut).mul(price.output);
  return uncached.add(cached).add(output).div(1_000_000);
}
