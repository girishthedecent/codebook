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
    // A source still PENDING after this never got its ingest event and may be resynced.
    stalePendingMs: 10 * 60 * 1000,
    // Every ingest step updates the source, and none takes more than a few minutes, so a
    // source PROCESSING this long belongs to a run that died (e.g. cancelled by hand).
    staleProcessingMs: 30 * 60 * 1000,
    // Lines of a repository file one content request returns.
    maxContentLines: 400,
  },
  ingestion: {
    // Part of the content hash: bump it when parsing or chunking changes, so existing
    // sources are re-indexed on their next resync instead of skipped.
    version: 1,
    // Sources ingesting at the same time.
    concurrency: 2,
    pdf: {
      // A page with fewer non-space characters counts as empty; this share of empty pages
      // means a scanned PDF without a text layer.
      minPageChars: 20,
      maxEmptyPageShare: 0.9,
    },
    chunking: {
      parentMaxTokens: 1_500,
      childTokens: 350,
      overlapTokens: 50,
      // Smaller sections (a "Part II" title page) merge into the next one.
      minSectionTokens: 20,
    },
    // Evals compare search with and without the model-written context.
    contextualRetrieval: true,
    contextualize: {
      parentsPerStep: 10,
      // Gemini Flash-Lite's free tier allows 15 requests a minute.
      minIntervalMs: 4_500,
      // Repositories: one call covers a pack of small files (the free tier allows 500 calls
      // a day), up to this many chunks and tokens of chunk text.
      codeChunksPerCall: 8,
      codeTokensPerCall: 4_000,
      packsPerStep: 10,
    },
    repo: {
      maxDownloadBytes: 200 * 1024 * 1024,
      // Guards against archives that inflate far beyond their download size.
      maxUnpackedBytes: 1024 * 1024 * 1024,
      maxEntries: 5_000,
      maxFileBytes: 500 * 1024,
      // Bounds memory and the draft while the archive is read.
      maxIndexedTokens: 250_000,
      // The free embedding quota is 1,000 texts a day; this leaves room for queries.
      maxChildChunks: 800,
      // Tests cost a lot of quota (most of a typical repository's text) for little answer
      // value, so they are left out unless turned on.
      includeTests: false,
      // Bump when a secret rule changes, so every repository is re-indexed (PDFs aren't).
      scannerVersion: 1,
    },
    // Two embedding batches, about a minute at the free-tier rate.
    childrenPerEmbedStep: 80,
    indexTimeoutMs: 120_000,
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
    // The whole tarball download, body included.
    downloadTimeoutMs: 120_000,
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
      // Gemini's free tier counts every text, not every request: 100 a minute. Documents
      // (ingestion) stay under documentsPerMinute so queries always have room; a batch has
      // to fit in that window.
      batchSize: 40,
      concurrency: 1,
      documentsPerMinute: 80,
    },
    // How much of a prompt debug logs show.
    logPreviewChars: 500,
  },
} as const;
