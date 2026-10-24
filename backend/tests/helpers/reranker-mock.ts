import type { RerankOptions } from '../../src/modules/retrieval/retrieval.types.js';

// Stand-in for src/llm/reranker.ts. Use in a test file with:
//   vi.mock('../src/llm/reranker.js', () => import('./helpers/reranker-mock.js'));
// A doc scores the share of the query's words it contains, so tests can predict the order.

let available = true;

/** Makes rerank() answer null, as when the model failed to load. */
export function setRerankerAvailable(value: boolean) {
  available = value;
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);

export async function rerank(
  query: string,
  docs: string[],
  _options: RerankOptions = {},
): Promise<number[] | null> {
  if (!available) return null;
  const terms = words(query);
  return docs.map((doc) => {
    if (terms.size === 0) return 0;
    const found = words(doc);
    let hits = 0;
    for (const term of terms) if (found.has(term)) hits++;
    return hits / terms.size;
  });
}

export async function warmUpReranker() {}
