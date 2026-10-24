# Retrieval evals, 2026-10-24

Split DEV · code 35f8aa6c40d9 · 8 runs. Recall and MRR are on the ranking before the score threshold; NO_ANSWER cases count only toward no-answer accuracy. False-weak is the share of answerable cases the search called weak. A tainted run had cases where the reranker or a query mode fell back, so it measured something else.

## Results

| Config | Cases | Recall@5 | Recall@10 | MRR | nDCG@10 | No-answer | False-weak | p50 | p95 | Cost | Tainted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid | 46 | 0.901 | 0.937 | 0.885 | 0.869 | 0.500 | 0.000 | 39 ms | 86 ms | $0.0000 | no |
| hybrid-rerank | 46 | 0.917 | 0.984 | 0.839 | 0.846 | 0.500 | 0.048 | 10309 ms | 14263 ms | $0.0000 | no |
| hybrid-rerank-decompose | 46 | 0.925 | 0.984 | 0.835 | 0.845 | 0.500 | 0.048 | 7054 ms | 8274 ms | $0.0021 | no |
| hybrid-rerank-hyde | 46 | 0.893 | 0.960 | 0.832 | 0.841 | 0.500 | 0.071 | 7201 ms | 10885 ms | $0.0047 | no |
| hybrid-rerank-nocontext | 19 | 0.816 | 0.947 | 0.673 | 0.722 | – | 0.211 | 9312 ms | 11221 ms | $0.0000 | no |
| hybrid-rerank-rewrite | 46 | 0.917 | 0.984 | 0.827 | 0.843 | 0.500 | 0.048 | 6133 ms | 7956 ms | $0.0027 | no |
| keyword-only | 46 | 0.714 | 0.778 | 0.556 | 0.595 | 0.000 | 0.000 | 34 ms | 99 ms | $0.0000 | no |
| vector-only | 46 | 0.925 | 0.960 | 0.946 | 0.922 | 0.500 | 0.000 | 23 ms | 51 ms | $0.0000 | no |

### On CODE, CROSS_SOURCE only (to compare with hybrid-rerank-nocontext)

| Config | Cases | Recall@5 | Recall@10 | MRR | nDCG@10 | No-answer | False-weak | p50 | p95 | Cost | Tainted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid-rerank-nocontext | 19 | 0.816 | 0.947 | 0.673 | 0.722 | – | 0.211 | 9312 ms | 11221 ms | $0.0000 | no |
| hybrid | 19 | 0.868 | 0.895 | 0.868 | 0.854 | – | 0.000 | 34 ms | 54 ms | $0.0000 | no |
| hybrid-rerank | 19 | 0.921 | 1.000 | 0.723 | 0.772 | – | 0.105 | 11307 ms | 15648 ms | $0.0000 | no |
| hybrid-rerank-decompose | 19 | 0.921 | 1.000 | 0.723 | 0.772 | – | 0.105 | 7169 ms | 8274 ms | $0.0021 | no |
| hybrid-rerank-hyde | 19 | 0.868 | 0.947 | 0.735 | 0.769 | – | 0.158 | 7019 ms | 8638 ms | $0.0047 | no |
| hybrid-rerank-rewrite | 19 | 0.921 | 1.000 | 0.723 | 0.772 | – | 0.105 | 6443 ms | 9501 ms | $0.0027 | no |
| keyword-only | 19 | 0.658 | 0.737 | 0.491 | 0.536 | – | 0.000 | 32 ms | 51 ms | $0.0000 | no |
| vector-only | 19 | 0.921 | 0.947 | 0.908 | 0.900 | – | 0.000 | 21 ms | 27 ms | $0.0000 | no |

## By case type

Recall@5 (cases); no-answer accuracy for NO_ANSWER.

| Config | BOOK | CODE | MULTI_HOP | CROSS_SOURCE | NO_ANSWER |
| --- | --- | --- | --- | --- | --- |
| hybrid | 1.000 (15) | 0.867 (15) | 0.792 (8) | 0.875 (4) | 0.500 (4) |
| hybrid-rerank | 1.000 (15) | 0.933 (15) | 0.750 (8) | 0.875 (4) | 0.500 (4) |
| hybrid-rerank-decompose | 1.000 (15) | 0.933 (15) | 0.792 (8) | 0.875 (4) | 0.500 (4) |
| hybrid-rerank-hyde | 1.000 (15) | 0.867 (15) | 0.750 (8) | 0.875 (4) | 0.500 (4) |
| hybrid-rerank-nocontext | – | 0.800 (15) | – | 0.875 (4) | – |
| hybrid-rerank-rewrite | 1.000 (15) | 0.933 (15) | 0.750 (8) | 0.875 (4) | 0.500 (4) |
| keyword-only | 0.933 (15) | 0.600 (15) | 0.438 (8) | 0.875 (4) | 0.000 (4) |
| vector-only | 1.000 (15) | 0.933 (15) | 0.792 (8) | 0.875 (4) | 0.500 (4) |

## Reviewed and unreviewed cases

Recall@5 (cases).

| Config | Reviewed | Unreviewed |
| --- | --- | --- |
| hybrid | 0.901 (42) | – |
| hybrid-rerank | 0.917 (42) | – |
| hybrid-rerank-decompose | 0.925 (42) | – |
| hybrid-rerank-hyde | 0.893 (42) | – |
| hybrid-rerank-nocontext | 0.816 (19) | – |
| hybrid-rerank-rewrite | 0.917 (42) | – |
| keyword-only | 0.714 (42) | – |
| vector-only | 0.925 (42) | – |

## Worst cases of hybrid-rerank-decompose

| Case | Question | Expected | Top 3 retrieved |
| --- | --- | --- | --- |
| none-003 (NO_ANSWER) | How do I accept WebSocket upgrade requests on an Express app? | no answer expected | lib/request.js:171–187<br>lib/request.js:127–143<br>https://expressjs.com/en/guide/routing/ |
| none-005 (NO_ANSWER) | How do I turn on gzip compression for Express responses? | no answer expected | lib/response.js:213–234<br>lib/response.js:649–704<br>lib/response.js:334–373 |
| code-019 (CODE) | What error do I get when rendering a template that doesn't exist? | lib/application.js:558–565 | examples/mvc/views/404.ejs:1–13<br>examples/error-pages/index.js:1–57<br>examples/mvc/views/5xx.ejs:1–13 |
| multi-006 (MULTI_HOP) | How does a redirect decide which body to send back to the client? | lib/response.js:838–856, lib/response.js:574–599, lib/request.js:127–130 | lib/response.js:815–867 ✓<br>https://expressjs.com/en/guide/routing/ § Response methods<br>examples/auth/index.js:104–128 |
| cross-002 (CROSS_SOURCE) | The guide chains .get().post().put() on app.route('/book'). What does app.route actually return? | https://expressjs.com/en/guide/routing/ § app.route(), lib/application.js:256–258 | https://expressjs.com/en/guide/routing/ § Route methods<br>https://expressjs.com/en/guide/routing/ § app.route() ✓<br>https://expressjs.com/en/guide/routing/ § Warning |
| multi-009 (MULTI_HOP) | How does res.download eventually stream the file, and what happens to errors if I pass no callback? | lib/response.js:459–485, lib/response.js:396–416, lib/response.js:990–1011 | lib/response.js:897–965<br>lib/response.js:419–435<br>lib/response.js:437–486 ✓ |
| multi-007 (MULTI_HOP) | Trace what happens when a route calls res.render without a callback. | lib/response.js:897–921, lib/application.js:522–575, lib/view.js:133–159 | lib/response.js:897–965 ✓<br>lib/response.js:869–895<br>lib/application.js:463–520 |
| multi-010 (MULTI_HOP) | How does turning on trust proxy change what req.protocol returns? | lib/application.js:370–379, lib/utils.js:194–214, lib/request.js:297–315 | lib/request.js:283–343 ✓<br>lib/request.js:345–381<br>lib/request.js:433–486 |
| code-003 (CODE) | What happens when I pass a plain JavaScript object to res.send? | lib/response.js:146–158 | lib/response.js:516–569<br>lib/response.js:79–132<br>lib/response.js:334–373 |
| code-017 (CODE) | What happens if I call app.use without passing any middleware? | lib/application.js:210–214 | examples/error/index.js:1–53<br>examples/web-service/index.js:93–117<br>https://expressjs.com/en/guide/routing/ |
