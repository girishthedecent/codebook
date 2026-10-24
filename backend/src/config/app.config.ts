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
    graph: {
      // Part of the repo content hash: bump when extraction or resolution changes.
      version: 1,
    },
    website: {
      // Part of the website content hash: bump when extraction changes.
      version: 1,
      pageTimeoutMs: 15_000,
      maxPageBytes: 5 * 1024 * 1024,
      requestGapMs: 500,
      // The whole crawl runs in one step; pages left when this runs out count as skipped.
      crawlBudgetMs: 3 * 60 * 1000,
      maxCrawlDelayMs: 5_000,
      // Readability slows down sharply on deep DOMs; bigger pages use the plain extractor.
      readabilityMaxDepth: 64,
      readabilityMaxElements: 10_000,
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
  graph: {
    maxDepth: 3,
    maxPathDepth: 6,
    // Symbols one answer lists, and rows one walk may produce.
    maxResults: 100,
    maxWalkRows: 20_000,
    maxCandidates: 20,
  },
  retrieval: {
    // Taken from each list (per query), fused, and the best rerankK go to the reranker.
    candidateK: 30,
    rerankK: 20,
    defaultTopK: 8,
    maxTopK: 20,
    rrfK: 60,
    // Off by default: on the DEV evals MiniLM added a little recall@10 (0.960 → 0.984) but
    // made the first result worse on code (MRR 0.946 → 0.839), for ~2s of CPU per search.
    rerankByDefault: false,
    // How much a keyword list counts in the fusion next to a vector list. From the DEV evals:
    // at 1 keyword matches on common words pulled hybrid below vector alone (see
    // evals/CHANGELOG.md).
    keywordWeight: 0.25,
    // HNSW only kicks in on large workspaces; smaller ones get an exact scan.
    efSearch: 80,
    // Without the reranker, a best cosine similarity below this marks the search weak. Set
    // from the DEV evals (gemini-embedding-2): answerable questions' best match scored
    // 0.67-0.84, questions with no answer 0.61-0.67. Depends on the embedding model.
    weakVectorScore: 0.65,
    // Parent sections handed to a model, by their token counts.
    maxContextTokens: 6_000,
    maxQueryChars: 1_000,
    maxSourceIds: 25,
    reranker: {
      batchSize: 8,
      // Query and passage together, the models' input limit.
      maxTokens: 512,
      // Each model scores on its own scale: below min a result is dropped, a best score
      // below weak marks the search weak. Tuned on the evals.
      thresholds: {
        'Xenova/bge-reranker-base': { min: 0.02, weak: 0.2 },
        'Xenova/ms-marco-MiniLM-L-6-v2': { min: 0.01, weak: 0.1 },
      } as Record<string, { min: number; weak: number }>,
    },
    queryModes: {
      maxSubQueries: 3,
      // Generated texts kept in memory, so repeated questions (an eval matrix) pay once.
      memoSize: 500,
    },
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
