# Performance pass

PLAN.md 17.3: the main queries under `EXPLAIN (ANALYZE, BUFFERS)`, the HNSW `ef_search`
setting, and the reranker batch size. Measured 2026-10-25 on the dev database with the
indexed eval corpus.

## Setup and caveats

- Data: 3,872 chunks in five workspaces. The biggest, `eval-core` (DDIA, the express repo
  and the express routing docs page), has 1,155 child chunks; DDIA alone 924; the gate
  corpus (repo and docs) 231. Code graph: 620 symbols, 3,480 edges.
- Questions: the 60 questions of `evals/datasets/core.json` whose query embeddings are in
  `EmbeddingCache`, so nothing called a model. Network access other than the reranker's
  model hub check was blocked during the runs.
- The scripts ran on two CPU cores at low priority while other jobs shared the machine;
  absolute numbers are noisy and on the high side. Comparisons were run back to back
  (interleaved where it mattered).

## Queries

| Query                                                       | Plan at this size                                                                                                                                               | Time          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Vector search, `eval-core` (top 30)                         | Seq scan over the table, top-N sort. The planner prefers it to the HNSW index below a few thousand rows per workspace                                           | 18 ms         |
| Keyword search, `eval-core` (OR'd lexemes)                  | Seq scan with `tsv @@ query`, 326 matches ranked by `ts_rank_cd`, top-N sort. Most of the time is reading `tsv` for every row                                   | 27 ms         |
| Graph walk, 3 hops, most-called symbol (backward / forward) | Recursive union; each step uses `CodeEdge_toSymbolId_type_idx` / `CodeEdge_fromSymbolId_type_idx`                                                               | 0.8 / 0.4 ms  |
| Monitoring: answer stats (7 days)                           | `Message_createdAt_idx` range scan                                                                                                                              | 0.2 ms        |
| Monitoring: provider stats (7 days)                         | Seq scan of `UsageEvent` (984 rows)                                                                                                                             | 1.4 ms        |
| Monitoring: usage per day (30 days)                         | Was a nested loop comparing every day with every event (31 × all rows, 30,450 rows filtered). Rewritten to group the range once and join the days to the totals | 14.4 → 1.5 ms |

The whole search, by stage (60 questions, no reranker, query mode `none`):

| Workspace   | Embed (cache) | Vector     | Keyword     | Parents   | Total p50 / p95 |
| ----------- | ------------- | ---------- | ----------- | --------- | --------------- |
| `eval-core` | 8 / 34 ms     | 36 / 81 ms | 60 / 106 ms | 4 / 11 ms | 75 / 131 ms     |
| DDIA only   | 4 / 11 ms     | 26 / 35 ms | 37 / 76 ms  | 4 / 9 ms  | 51 / 85 ms      |

Vector and keyword run in parallel, so the total is less than their sum.

### Index changes

One query change, no new index. The `usagePerDay` rewrite (`monitoring.repository.ts`)
fixed the only plan whose cost grew with days × events. What to watch as data grows:

- `UsageEvent` gets a row per model call and is read by `createdAt` range in monitoring;
  add an index on `createdAt` once it is past a few hundred thousand rows.
- Keyword search reads every `tsv` in the table today. With many workspaces the planner
  switches to the GIN index or the `workspaceId` index; worth another `EXPLAIN` then.

## HNSW `ef_search`

At today's sizes Postgres never uses the HNSW index: every workspace is small enough for
an exact scan, so changing `ef_search` doesn't change a single search result, and a
retrieval-eval sweep over it would return the same numbers each time. Measured instead
was what the index would give once it is used: the same 60 questions with the index
forced (`enable_seqscan` and `enable_bitmapscan` off, iterative scan on, as in
`vectorSearch`), compared to the exact top 30.

| ef_search     | `eval-core` recall@10 / @30 | p50 / p95      | DDIA recall@10 / @30 | p50 / p95      |
| ------------- | --------------------------- | -------------- | -------------------- | -------------- |
| exact scan    | 1.000 / 1.000               | 18.2 / 36.2 ms | 1.000 / 1.000        | 15.2 / 26.5 ms |
| 10            | 0.970 / 0.953               | 5.7 / 8.8 ms   | 0.940 / 0.900        | 7.8 / 12.9 ms  |
| 20            | 0.970 / 0.954               | 6.1 / 10.4 ms  | 0.962 / 0.924        | 8.1 / 11.8 ms  |
| 40            | 0.970 / 0.954               | 5.0 / 9.2 ms   | 0.965 / 0.936        | 7.6 / 13.5 ms  |
| **80 (kept)** | 0.972 / 0.958               | 4.6 / 8.1 ms   | 0.982 / 0.963        | 6.8 / 12.8 ms  |
| 160           | 0.978 / 0.974               | 6.4 / 12.3 ms  | 0.988 / 0.977        | 7.5 / 12.0 ms  |

On the gate corpus (231 children) every setting matched the exact scan.

**Kept at 80.** Below 80 the DDIA workspace loses nearest neighbours; 160 gains little
more at this size, and the cost of a bigger `ef_search` grows with the index. The
recall stays under 1 even at 160 because the index covers every workspace and the
workspace filter is applied while walking it. When workspaces get big enough for the
planner to pick the index, rerun this sweep there.

## Reranker

MiniLM (`Xenova/ms-marco-MiniLM-L-6-v2`, q8), 6 questions × 20 candidates (`rerankK`), batch
sizes interleaved per question:

| Batch size     | p50   | p95 (max of 6) |
| -------------- | ----- | -------------- |
| **8 (kept)**   | 5.3 s | 5.6 s          |
| 20 (one batch) | 4.8 s | 5.7 s          |

Loading the model takes 1–7 s, depending on the disk cache. With reranking off by default
it loads on the first search that asks for it; turning `rerankByDefault` on also loads it
at boot (`warmUpReranker`).

**Kept at 8.** One batch of 20 was about 10% faster at p50 and no faster at p95, inside
the noise of a shared machine. Smaller batches keep the abort check between batches (a
closed stream stops the rest of the work) and pad less. On two busy cores reranking costs
about 5 s per search, which is why it stays off by default (`rerankByDefault: false`) and
at most `concurrentReranks` run at once.

## How to rerun

The scripts used for these numbers aren't part of the repo. To repeat a measurement:

- Queries: `EXPLAIN (ANALYZE, BUFFERS)` in a `BEGIN READ ONLY` transaction, with the SQL
  from `retrieval.repository.ts`, `graph.repository.ts` and `monitoring.repository.ts`.
- `ef_search`: in one transaction, `set_config('hnsw.ef_search', …, true)`,
  `set_config('hnsw.iterative_scan', 'relaxed_order', true)`, and `enable_seqscan` /
  `enable_bitmapscan` off to force the index; compare the ids with the exact scan.
- Search stages: `search()` returns `debug.timings`; the query vectors come from
  `EmbeddingCache` when the question has been embedded before.
