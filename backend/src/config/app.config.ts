import { readFileSync } from 'node:fs';

// Same relative path from src/config and dist/config.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Tunables that don't need to change per environment. Each phase adds its own section.
export const appConfig = {
  version: pkg.version,
  http: {
    jsonLimit: '1mb',
    // Sign-in / sign-up payloads are a few hundred bytes.
    authBodyLimitBytes: 64 * 1024,
  },
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
  workspaces: {
    maxPerUser: 20,
  },
  sources: {
    maxPerWorkspace: 25,
    maxPdfBytes: 50 * 1024 * 1024,
    // As GitHub reports it (the packed repository), checked before anything is downloaded.
    maxRepoSizeMb: 200,
    website: { maxDepth: 2, defaultDepth: 0, maxPages: 50, defaultPages: 10 },
    // How often the progress stream re-reads the source row.
    progressPollMs: 1_000,
  },
  sse: {
    heartbeatMs: 15_000,
  },
  inngest: {
    // Inngest posts step state back to /api/inngest, which can outgrow the API's JSON limit.
    bodyLimit: '4mb',
  },
  github: {
    apiUrl: 'https://api.github.com',
    timeoutMs: 10_000,
  },
  llm: {
    retry: {
      // Retries per model before moving to the fallback.
      maxRetries: 2,
      baseDelayMs: 250,
      maxDelayMs: 2_000,
      // A longer retry-after means the minute's quota is gone; the fallback answers sooner.
      maxRetryAfterMs: 5_000,
    },
    embeddings: {
      batchSize: 100,
      concurrency: 2,
    },
    // How much of a prompt debug logs show.
    logPreviewChars: 500,
  },
} as const;
