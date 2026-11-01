# CodeBook web app

The browser app for the CodeBook API in `../backend`. Vite + React, TanStack Router and Query, Tailwind with custom design tokens.

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
| `pnpm build` | Typecheck, production build to `dist/`, then prerender the landing page into `dist/index.html` |
| `pnpm preview` | Serve `dist/` on :3000 |
| `pnpm lint` | ESLint and Prettier check |
| `pnpm format` | Prettier write |
| `pnpm typecheck` | `tsc -b --noEmit` |
| `pnpm gen:api` | Regenerate `src/api/schema.d.ts` from the backend's OpenAPI document |
| `pnpm size` | Bundle budgets: entry and CSS from `.size-limit.json`, and first-visit JS from `scripts/initial-size.ts`, measured separately for the landing page and the app (each under 150 KB gzipped). Run after `pnpm build` |
| `pnpm lhci` / `pnpm lhci:mobile` | Lighthouse CI, desktop and mobile; run after `pnpm build` |

Lighthouse budgets live in `lighthouserc.json` (desktop) and `lighthouserc.mobile.json`; CI runs them with `@lhci/cli` against `pnpm preview`.

## Folders

```
src/
  api/        generated schema, fetch client, SSE parser, queries per module
  auth/       better-auth client, session helpers, `useMe`, route guards
  routes/     TanStack file routes (routeTree.gen.ts is generated)
  features/   screen logic per module (chat, sources, viewer, graph, study, …)
  ui/         shared components, built on Radix primitives
  workers/    Shiki highlighting worker and its themes
  lib/        small helpers (class names, keyboard shortcuts, theme, breakpoints, viewer URL params)
  styles/     tokens.css (design tokens) and base.css
  i18n/       all user-facing strings
  main.tsx    entry for the app; landing.tsx is the entry for `/`
scripts/      gen-api, prerender (landing page), capture-demo (landing data), initial-size (first-visit budget)
```
