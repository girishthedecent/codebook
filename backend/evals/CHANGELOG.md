# Retrieval eval changelog

Each tuning change and the numbers behind it. Dataset `core`, DEV split (46 cases: 42 answerable, 4 with no answer) unless noted.

## 2026-10-24 · first baseline

| Config                 | Recall@5 | Recall@10 | MRR   |
| ---------------------- | -------- | --------- | ----- |
| vector-only            | 0.925    | 0.960     | 0.946 |
| hybrid                 | 0.897    | 0.929     | 0.822 |
| keyword-only           | 0.714    | 0.778     | 0.556 |
| hybrid-rerank (MiniLM) | 0.869    | 0.960     | 0.820 |

- Keyword search (OR of the question's lexemes) pulls hybrid below vector alone: it ranks chunks that share common words ("request", "data") high, and RRF gives its list as much weight as the vector list.
- The MiniLM reranker helps the book (MRR 0.869 → 0.967 over hybrid) and hurts code (0.733 → 0.663): it was trained on web passages (MS MARCO), not source code.
- `bge-reranker-base` takes ~23s for 20 chunks on a 4-core CPU and starved the event loop during the eval (DB connections timed out); the run was stopped after 7 cases. MiniLM (~2s) is the default.

## 2026-10-24 · weak threshold without the reranker

`weakVectorScore` 0.55 → 0.65. The best vector match scored 0.67–0.84 for answerable questions and 0.61–0.67 for the no-answer ones; 0.65 leaves a margin instead of fitting the gap exactly. No-answer accuracy 0/4 → 2/4, false-weak stays 0.

## 2026-10-24 · keyword weight in the fusion

RRF counts each keyword list at `keywordWeight` next to a vector list.

| keywordWeight | hybrid R@5 | hybrid MRR | hybrid-rerank R@5 | hybrid-rerank R@10 | hybrid-rerank MRR |
| ------------- | ---------- | ---------- | ----------------- | ------------------ | ----------------- |
| 1             | 0.897      | 0.822      | 0.869             | 0.960              | 0.820             |
| 0.5           | 0.897      | 0.837      | 0.917             | 0.984              | 0.827             |
| 0.25          | 0.901      | 0.885      | 0.917             | 0.984              | 0.839             |

0.25 kept. Vector-only still has the best MRR (0.946): the keyword list and MiniLM both add noise at the top for code questions, while the reranker's gain is in recall@10.

## 2026-10-24 · query modes, contextual retrieval, held-out check

All with keyword weight 0.25, the reranker (MiniLM) on 2 CPU cores.

| Config        | R@5   | R@10  | MRR   |
| ------------- | ----- | ----- | ----- |
| hybrid-rerank | 0.917 | 0.984 | 0.839 |
| + rewrite     | 0.917 | 0.984 | 0.827 |
| + HyDE        | 0.893 | 0.960 | 0.832 |
| + decompose   | 0.925 | 0.984 | 0.835 |

- Rewrite changes nothing on standalone questions (it is for follow-ups in a chat). HyDE's guessed code named things express doesn't have and lost `code-003`. Decompose found one more passage of a multi-part question (`multi-007`). None is worth a model call by default.
- Contextual retrieval, on the 19 CODE + CROSS_SOURCE cases (hybrid-rerank against the same corpus indexed without notes): with the notes R@5 0.921 / R@10 1.000 / MRR 0.723, without 0.816 / 0.947 / 0.673. +10.5 points of recall@5 is about two of the 19 questions: a clear direction, not a precise size.
- HELDOUT (14 cases, looked at once after the DEV decisions): vector-only 0.974 / 1.000 / 0.885, hybrid-rerank 0.897 / 1.000 / 0.748. Both find everything in the top 10; with 5 CODE cases it says little more than that.
- Small numbers throughout: 4 NO_ANSWER cases on DEV (the 0.65 weak threshold sits between them and the answerable ones, so it is fitted, not validated), 15 CODE, 8 MULTI_HOP.
- Latency in the reports isn't comparable across configs: configs without a query mode ran two cases at a time (two reranks sharing 2 cores), query-mode configs one at a time, and only the first config of a matrix paid for uncached query embeddings.

**Decision (from DEV):** default search is hybrid (keyword ¼) with the reranker **off** (`rerankByDefault: false`): on DEV the reranker lowers MRR (hybrid 0.885 → 0.839) for a small recall@10 gain (0.937 → 0.984) and ~2 s of CPU. Vector-only scores higher than hybrid on these paraphrased questions; hybrid stays the default because exact identifiers (`findByEmail`, an error code) are matched by the keyword list and this set has few such questions. Reranking stays available per search. Revisit with the answer evals or a code-aware reranker.
