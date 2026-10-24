import { describe, expect, it } from 'vitest';
import { serverConfig } from '../src/config/index.js';
import { rerank } from '../src/llm/reranker.js';

// Real local models; the first run downloads them into RERANKER_CACHE_DIR.
// Run with: LIVE_TESTS=1 pnpm test tests/reranker.live.test.ts
describe.skipIf(!serverConfig.LIVE_TESTS)('live reranker', { timeout: 600_000 }, () => {
  const query = 'How does leader-based replication send writes to the followers?';
  const docs = [
    'Bread rises because yeast ferments the sugars in the dough and releases carbon dioxide.',
    'In leader-based replication, clients send writes to the leader, which applies them and ' +
      'streams the change to every follower through its replication log.',
    'The museum is open from nine to five, except on public holidays.',
  ];

  it.each(['Xenova/bge-reranker-base', 'Xenova/ms-marco-MiniLM-L-6-v2'])(
    '%s scores the relevant passage above the others',
    async (model) => {
      const scores = await rerank(query, docs, { model });

      expect(scores).toHaveLength(3);
      const [bread, replication, museum] = scores!;
      expect(replication).toBeGreaterThan(0.5);
      expect(replication).toBeGreaterThan(bread!);
      expect(replication).toBeGreaterThan(museum!);
    },
  );
});
