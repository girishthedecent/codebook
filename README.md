# CodeBook

A workspace that connects what's written about code (books, docs, specs, papers) with the code itself.
Ask a question and an agent picks how to look for the answer — vector search, keyword search, a book's
table of contents, the code's call graph, or the web — and answers with citations to the page or file:line.

Backend only for now. The full build plan lives in [PLAN.md](PLAN.md).

## Local setup

Needs Node 22, pnpm and Docker.

```bash
cd backend
docker compose up -d            # postgres + pgvector, minio, inngest dev server
cp .env.example .env            # then set BETTER_AUTH_SECRET (see below) and the API keys
pnpm install
pnpm db:deploy                  # apply migrations
pnpm dev                        # http://localhost:4000/api/v1/health/ready
```

`BETTER_AUTH_SECRET` is required (32+ characters); generate one with `openssl rand -base64 32`.
GitHub login turns on only when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are both set
(OAuth app callback: `http://localhost:4000/api/auth/callback/github`).

Checks: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (tests use the `codebook_test` database).

| Service | URL |
|---|---|
| API | http://localhost:4000 |
| Inngest dev UI | http://localhost:8288 |
| MinIO console | http://localhost:9011 (minio / minio12345) |
