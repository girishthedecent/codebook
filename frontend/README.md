# CodeBook web app

The browser app for the CodeBook API in `../backend`. Vite + React, TanStack Router and Query, Tailwind with our own tokens. The plan and design rules are in [`PLAN.md`](./PLAN.md).

## Run

```sh
pnpm install
pnpm dev          # http://localhost:3000, proxies /api to the backend on :4000
```

Start the backend first (`cd ../backend && pnpm dev`). No environment variables are needed in development: the dev server forwards `/api` and `/openapi.json` to `http://localhost:4000`, so the auth cookie stays first-party.

## Scripts

| Script | What |
|---|---|
| `pnpm dev` | Dev server on :3000 |
| `pnpm build` | Typecheck and production build to `dist/` |
| `pnpm preview` | Serve `dist/` on :3000 |
| `pnpm lint` | ESLint and Prettier check |
| `pnpm typecheck` | `tsc -b` |
| `pnpm gen:api` | Regenerate `src/api/schema.d.ts` from the backend's OpenAPI document |
| `pnpm size` | Bundle budgets from `.size-limit.json` (run after `pnpm build`) |

Lighthouse budgets live in `lighthouserc.json` (desktop) and `lighthouserc.mobile.json`; CI runs them with `@lhci/cli` against `pnpm preview`.

## Folders

```
src/
  api/        generated schema, fetch client, SSE parser, queries per module
  auth/       better-auth client, session hook, guards
  routes/     TanStack file routes (routeTree.gen.ts is generated)
  features/   screen logic per module (chat, sources, viewer, graph, study, …)
  ui/         our components, built on radix primitives
  workers/    pdf.js and Shiki workers
  lib/        small helpers (cn, keyboard, formatting)
  styles/     tokens.css (design tokens) and base.css
  i18n/       all user-facing strings
scripts/      gen-api
```
