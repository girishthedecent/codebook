# Security review

What protects the backend against each risk below, how that was checked, and the result.
Where a check says "test", that test fails if the protection is removed; the ones with no
natural home elsewhere live in `backend/tests/security.test.ts`.

Reviewed 2026-10-25; secrets and logs re-checked 2026-10-28 after the backup Gemini key.

## Summary

| #   | Area                                   | Result                   |
| --- | -------------------------------------- | ------------------------ |
| 1   | Authentication on every route          | Pass                     |
| 2   | Data scoped to its user or workspace   | Pass                     |
| 3   | Signed Inngest requests                | Pass                     |
| 4   | SSRF on user-supplied URLs             | Pass                     |
| 5   | PDF uploads                            | Pass                     |
| 6   | Repository tarballs                    | Pass                     |
| 7   | Regex denial of service in code search | Pass                     |
| 8   | Secrets kept out of logs and storage   | Pass                     |
| 9   | Prompt injection                       | Pass                     |
| 10  | Headers, CORS and cookies              | Pass                     |
| 11  | Email enumeration at sign-up           | Accepted                 |
| 12  | Dependency audit                       | **Open: two advisories** |
| 13  | Error responses                        | Pass                     |

## The checks

### 1. Authentication on every route

Every route needs a session except health, auth, the demo, Inngest and the API docs.

- **Protection:** `requireAuth` at the top of each v1 router; nested routers inherit it.
  Admin routes use `requireAdmin`, which answers 404 to everyone else, so they don't
  reveal that they exist.
- **Test:** `security.test.ts` walks every route of every router in `v1Mounts`, nested
  ones included, and calls it without a cookie. Everything answers 401 except
  `/health/*` and `/demo*` (public) and `/monitoring/*` and `/evals/*` (404).

### 2. Data scoped to its user or workspace

- **Protection:** user-facing reads go through `find*ForUser` or `assertWorkspaceAccess`.
  Repository functions that take a bare id (`findSource`, `updateSourceIfExists`,
  `deleteConversation` and the like) are only called after that check, or from Inngest
  functions working on ids the app wrote itself.
- **Checked by:** a review of every `*.repository.ts` export and its callers, and the
  cross-user tests in the workspaces, sources, source content, conversations, chat, chat
  tools, retrieval, graph, study and memory suites.
- **Note:** `findArtifact` in `study.repository.ts` takes a bare id; its only caller is
  the study job checking whether its own run was cancelled (`isStudyActive`).

### 3. Signed Inngest requests

- **Protection:** `serve()` verifies each request against `INNGEST_SIGNING_KEY`. In
  production the config refuses to start without the key, or with `INNGEST_DEV` on.
- **Test:** `config/index.test.ts` (key required, dev mode refused in production), and
  `security.test.ts`, where an unsigned POST to `/api/inngest` in production gets 401.

### 4. SSRF on user-supplied URLs

- **Protection:**
  - Websites: `safeFetch` checks the resolved address when it connects, which defeats DNS
    rebinding, and again on every redirect.
  - Repositories: the URL is reduced to owner and name, and only `api.github.com` is
    called; the tarball redirect must go to `https://codeload.github.com`.
  - Model and search providers (Gemini, Groq, Tavily) are fixed hosts.
- **Checked by:** a review of every `fetch(` in `src`, and `httpFetch.test.ts`: loopback,
  the cloud metadata address, a private DNS answer, a redirect to a private address, and
  the size and content-type limits.

### 5. PDF uploads

- **Protection:** multer limits the size and takes one file. The bytes must start with
  `%PDF-`, whatever the file is called. The storage key is built from the user, workspace
  and source ids only, never from the file name.
- **Test:** `sources.test.ts`, "rejects a file that only pretends to be a PDF", and the
  size tests.

### 6. Repository tarballs

- **Protection:** the archive is read in memory and never written to disk. `..` paths,
  symlinks, hard links and fifos are skipped. Entries, unpacked bytes, downloaded bytes and
  indexed tokens each have a cap.
- **Test:** `repo.archive.test.ts`, one test per cap and per skipped entry kind.

### 7. Regex denial of service in code search

- **Protection:** `search_code` caps the pattern length (`maxPatternChars`) and runs the
  regex in Postgres under a per-transaction `statement_timeout`, limited to the
  workspace's repositories.
- **Test:** `chatTools.test.ts` (the timeout is set; other workspaces are never searched).

### 8. Secrets kept out of logs and storage

- **Protection:**
  - Request logs carry the method, the path without its query string, and the status.
  - Prisma query logs only appear at `silly`.
  - Files from repositories go through a secret scanner that redacts values, and
    `.env`-style files are skipped.
  - Inngest event payloads hold ids and settings only.
  - Provider keys, the backup Gemini key (`GEMINI_API_KEY_2`) among them, are only read
    from the environment. Logs and usage rows name a model and, for the backup key, the
    label `#backup`, never a key. The summary of a quota error keeps the limit that ran
    out and drops the rest of the provider's message, Groq's organisation id included.
- **Test:** `security.test.ts` signs up, signs in with a wrong password, calls `/me`,
  sends a bad cookie and signs out at debug level, and finds no password, cookie or token
  in the output; it also checks that no Inngest event field could hold a secret or user
  text. `secret.scanner.test.ts` and `file.filter.test.ts` cover repository files.

### 9. Prompt injection

- **Protection:** text from sources, tools and the web goes into `<source>` and
  `<tool_result>` blocks, with look-alike tags neutralised and attributes escaped, and
  the prompts say those blocks are material, not instructions. Tools take source ids from
  the model but check them against the conversation's workspace (`toolSource`), so
  another workspace's id reads as missing.
- **Test:** `chatTools.test.ts` (foreign ids dropped, tags in pages escaped).

### 10. Headers, CORS and cookies

- **Protection:**
  - `helmet()` with its defaults.
  - CORS only for `TRUSTED_ORIGINS`.
  - The session cookie is HttpOnly and SameSite=Lax, and in production Secure with a
    `__Secure-` name.
  - Writes from a browser need a trusted Origin (`requireTrustedOrigin`): the frontend's
    `TRUSTED_ORIGINS`, plus the API's own origin (`BETTER_AUTH_URL`) so that "Try it out"
    in the Swagger UI works. That origin serves only the app's own pages (`/docs`).
  - Deployed behind a proxy: `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` are the public URL
    browsers use, and `TRUST_PROXY` is a hop count, never `true` (the config refuses it in
    production), so the per-IP limits see the address the nearest proxy saw.
- **Test:** `app.test.ts` (CORS), `auth.test.ts` (HttpOnly, SameSite), and
  `security.test.ts` in production mode (Secure cookie, HSTS, nosniff, CSP, no
  `x-powered-by`).

### 11. Email enumeration at sign-up (accepted)

Sign-up answers 422 for an email that is already registered, better-auth's default. With no
email verification, hiding that would buy little; better-auth's per-IP rate limit on the
auth routes is the mitigation.

### 12. Dependency audit (open)

`pnpm-lock.yaml` is committed, and `pnpm audit --prod` is run by hand. Two advisories are
open; see [Dependency audit](#dependency-audit) below.

### 13. Error responses

- **Protection:** `genericErrorHandler` sends a fixed message and code for anything that
  isn't an `AppError`. The error itself only goes to the log.
- **Test:** `security.test.ts` (a real Postgres error carrying SQL, and an error carrying
  an address and a password, both answer the generic 500), and `error.middleware.test.ts`.

## Dependency audit

`pnpm audit --prod` on 2026-10-25 found five advisories. undici was upgraded to 8.12.2 the
same day, since the crawler fetches pages from servers that users choose. Two remain:

| Severity | Package     | Installed | Fixed in | Issue                                                                   | Reached through                                      |
| -------- | ----------- | --------- | -------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| high     | multer      | 2.4.0     | 2.5.0    | DoS through a pending async `fileFilter` after the request is torn down | direct (PDF upload); our `fileFilter` is synchronous |
| high     | body-parser | 2.3.0     | 2.4.0    | DoS through trailing bytes after a compressed body                      | express 5.3.0, swagger-ui-express                    |

Both fixes were released on 2026-10-22, and dependencies are only taken once a release is
about two weeks old. After 2026-11-05: upgrade multer to 2.5.0 and body-parser to 2.4.0
(through express's range or a pnpm override), audit again, and update this section. Until
then the body-parser issue is the one that matters, since every JSON route accepts a
compressed body.

## Routes outside `/api/v1`

- **`/api/auth/*`** (better-auth): the body is read with a size cap first; the origin check
  is on, with tests; better-auth's per-IP rate limit applies in dev and production; guest
  sign-in has its own per-IP cap in front of it (`guestSignIn`).
- **`/api/inngest`**: signed requests only in production (check 3).
- **`/openapi.json`, `/docs`**: public and read-only.

## Keeping this current

Update this review when a dependency upgrade closes check 12, and whenever the backend gains
a new kind of exposure: a new outbound fetch, a new public or unauthenticated route, a new
upload type, or a new place secrets are read from.
