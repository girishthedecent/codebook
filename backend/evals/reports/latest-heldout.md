# Retrieval evals, 2026-10-24

Split HELDOUT · code 35f8aa6c40d9 · 2 runs. Recall and MRR are on the ranking before the score threshold; NO_ANSWER cases count only toward no-answer accuracy. False-weak is the share of answerable cases the search called weak. A tainted run had cases where the reranker or a query mode fell back, so it measured something else.

## Results

| Config | Cases | Recall@5 | Recall@10 | MRR | nDCG@10 | No-answer | False-weak | p50 | p95 | Cost | Tainted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid-rerank | 14 | 0.897 | 1.000 | 0.748 | 0.795 | 0.000 | 0.077 | 11026 ms | 12238 ms | $0.0000 | no |
| vector-only | 14 | 0.974 | 1.000 | 0.885 | 0.902 | 0.000 | 0.000 | 917 ms | 6778 ms | $0.0001 | no |

## By case type

Recall@5 (cases); no-answer accuracy for NO_ANSWER.

| Config | BOOK | CODE | MULTI_HOP | CROSS_SOURCE | NO_ANSWER |
| --- | --- | --- | --- | --- | --- |
| hybrid-rerank | 1.000 (5) | 0.800 (5) | 0.833 (2) | 1.000 (1) | 0.000 (1) |
| vector-only | 1.000 (5) | 1.000 (5) | 0.833 (2) | 1.000 (1) | 0.000 (1) |

## Reviewed and unreviewed cases

Recall@5 (cases).

| Config | Reviewed | Unreviewed |
| --- | --- | --- |
| hybrid-rerank | 0.897 (13) | – |
| vector-only | 0.974 (13) | – |

## Worst cases of vector-only

| Case | Question | Expected | Top 3 retrieved |
| --- | --- | --- | --- |
| none-004 (NO_ANSWER) | Which headers does Express send back for a CORS preflight request? | no answer expected | lib/request.js:1–61<br>lib/response.js:649–704<br>LICENSE:1–24 |
| multi-008 (MULTI_HOP) | How does the etag setting end up affecting the ETag header on responses? | lib/application.js:363–366, lib/utils.js:130–152, lib/response.js:161–193 | lib/response.js:166–211 ✓<br>lib/response.js:134–165 ✓<br>lib/utils.js:194–257 |
| book-012 (BOOK) | How does a log-based message broker keep track of which messages a consumer has already processed? | book p. 457 | book p. 455<br>book pp. 457–458 ✓<br>book pp. 456–457 ✓ |
| code-004 (CODE) | Does Express write a body when it answers a HEAD request through res.send? | lib/response.js:213–219 | lib/response.js:166–211<br>lib/response.js:213–234 ✓<br>lib/response.js:79–132 |
| code-020 (CODE) | If a view file isn't found directly, where else does Express look for it? | lib/view.js:169–187 | lib/view.js:52–95<br>lib/view.js:169–205 ✓<br>lib/view.js:97–167 |
