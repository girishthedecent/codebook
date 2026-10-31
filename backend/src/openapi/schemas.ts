import { z } from 'zod';
import {
  EdgeType,
  EvalCaseOrigin,
  EvalCaseType,
  EvalRunStatus,
  EvalSplit,
  Feedback,
  IngestStage,
  JobStatus,
  MemoryKind,
  MessageRole,
  MessageStatus,
  SourceStatus,
  SourceType,
  StudyType,
  UsageType,
  WorkspaceTemplate,
} from '../generated/prisma/enums.js';
import { STUDY_ERROR_CODES } from '../modules/study/study.errors.js';
import { AGENT_TOOLS, SEARCH_MODES } from '../modules/workspaces/workspace.validator.js';

// Response bodies as the controllers send them. These only describe the API for the docs:
// nothing parses responses with them. Dates go out as ISO strings.

const date = z.iso.datetime();
const id = z.string();
// Columns stored as JSON whose shape belongs to another module (or changes by suite).
const json = z.unknown();

/** `{ success, message, data }`, the envelope of every JSON success response. */
export function success<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), message: z.string(), data });
}

export function page<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    // Pass back as `cursor` for the next page; null on the last one.
    nextCursor: z.string().nullable(),
  });
}

export const errorSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
    code: z
      .string()
      .describe(
        'VALIDATION_ERROR, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, PAYLOAD_TOO_LARGE, ' +
          'UPSTREAM_ERROR, SERVICE_UNAVAILABLE, INTERNAL, or on a 429 the limit that was hit: ' +
          'GUEST_LIMIT (the demo allowance), HOURLY_LIMIT, DAILY_LIMIT (questions), ' +
          "TOKEN_BUDGET (the day's model budget) or RATE_LIMITED (any other limit).",
      ),
    // On a 429: seconds until the limit's window ends (the Retry-After header has it too).
    retryAfterSec: z.int().optional(),
    // What the error says more about: the issues of a 400, or on a 409 for an ambiguous graph
    // symbol the candidates.
    details: z
      .union([
        z.array(z.object({ path: z.string(), message: z.string() })),
        z.object({ candidates: z.array(z.lazy(() => graphSymbolSchema)) }),
      ])
      .optional(),
    correlationId: z.string().optional(),
  })
  .meta({ id: 'Error' });

export const meSchema = z
  .object({
    id,
    email: z.string(),
    name: z.string(),
    image: z.string().nullable(),
    isGuest: z.boolean(),
    isAdmin: z.boolean(),
    createdAt: date,
  })
  .meta({ id: 'Me' });

export const livenessSchema = z
  .object({ status: z.literal('ok'), version: z.string(), uptimeSeconds: z.int() })
  .meta({ id: 'Liveness' });

export const readinessSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    db: z.enum(['ok', 'down']),
    version: z.string(),
  })
  .meta({ id: 'Readiness' });

export const workspaceSettingsSchema = z
  .object({
    defaultSearchMode: z.enum(SEARCH_MODES).optional(),
    studyToolsEnabled: z.boolean().optional(),
    preferredTools: z.array(z.enum(AGENT_TOOLS)).optional(),
  })
  .meta({ id: 'WorkspaceSettings' });

export const workspaceSchema = z
  .object({
    id,
    name: z.string(),
    description: z.string().nullable(),
    template: z.enum(WorkspaceTemplate),
    isDemo: z.boolean(),
    settings: workspaceSettingsSchema,
    createdAt: date,
    updatedAt: date,
  })
  .meta({ id: 'Workspace' });

export const workspaceDetailSchema = workspaceSchema
  .extend({
    counts: z.object({
      // Sources by status.
      sources: z.record(z.enum(SourceStatus), z.int()),
      conversations: z.int(),
    }),
  })
  .meta({ id: 'WorkspaceDetail' });

export const sourceSchema = z
  .object({
    id,
    workspaceId: id,
    type: z.enum(SourceType),
    title: z.string(),
    status: z.enum(SourceStatus),
    stage: z.enum(IngestStage),
    progress: z.int(),
    error: z.string().nullable(),
    // PDF: fileName, size, mime. Repository: owner, repo, ref, defaultBranch. Website: url,
    // maxDepth, maxPages.
    origin: z.record(z.string(), json),
    stats: z.record(z.string(), json),
    lastIngestedAt: date.nullable(),
    createdAt: date,
    updatedAt: date,
  })
  .meta({ id: 'Source' });

export const demoSchema = z
  .object({
    workspace: workspaceSchema,
    sources: z.array(sourceSchema),
    // Three or four questions worth asking the demo's sources, in the order to show them.
    starterQuestions: z.array(z.string()),
  })
  .meta({ id: 'Demo' });

type TocNode = {
  id: string;
  title: string;
  number: string | null;
  level: number;
  pageStart: number | null;
  pageEnd: number | null;
  children: TocNode[];
};

export const tocNodeSchema: z.ZodType<TocNode> = z
  .object({
    id,
    title: z.string(),
    number: z.string().nullable(),
    level: z.int(),
    pageStart: z.int().nullable(),
    pageEnd: z.int().nullable(),
    get children() {
      return z.array(tocNodeSchema);
    },
  })
  .meta({ id: 'TocNode' });

export const sourceFileSchema = z
  .object({
    id,
    path: z.string(),
    language: z.string().nullable(),
    sizeBytes: z.int(),
    pageStart: z.int().nullable(),
    pageEnd: z.int().nullable(),
    lineCount: z.int().nullable(),
    // Set for files that were listed but not indexed (binary, too big, vendored...).
    skippedReason: z.string().nullable(),
    createdAt: date,
  })
  .meta({ id: 'SourceFile' });

export const sourceContentSchema = z
  .union([
    // excerpt: the text was cut short for a visitor of the demo workspace.
    z.object({ page: z.int(), text: z.string(), excerpt: z.literal(true).optional() }),
    z.object({
      tocNode: z.object({
        id,
        title: z.string(),
        number: z.string().nullable(),
        level: z.int(),
        pageStart: z.int().nullable(),
        pageEnd: z.int().nullable(),
      }),
      text: z.string(),
      excerpt: z.literal(true).optional(),
    }),
    z.object({
      path: z.string(),
      language: z.string().nullable(),
      lineCount: z.int(),
      lineStart: z.int(),
      lineEnd: z.int(),
      lines: z.array(z.object({ n: z.int(), text: z.string() })),
    }),
  ])
  .meta({
    id: 'SourceContent',
    description:
      'A page, a TOC section, or a line range of a file, depending on the query. Visitors ' +
      'of the demo workspace get short excerpts only.',
  });

export const citationSchema = z
  .object({
    n: z.int(),
    kind: z.enum(['CHUNK', 'LINES', 'PAGES', 'WEB']),
    chunkId: z.string().optional(),
    sourceId: z.string().optional(),
    sourceTitle: z.string(),
    sourceType: z.enum(SourceType).optional(),
    path: z.string().optional(),
    heading: z.string().optional(),
    pageStart: z.int().optional(),
    pageEnd: z.int().optional(),
    lineStart: z.int().optional(),
    lineEnd: z.int().optional(),
    url: z.string().optional(),
    // The number points at a passage the agent was really shown.
    valid: z.boolean(),
    // Lexical support of the sentences citing it; null when nothing cited it.
    supported: z.boolean().nullable(),
    snippet: z.string(),
  })
  .meta({ id: 'Citation' });

export const toolCallSchema = z
  .object({
    // The id its `step` events carry. Missing on answers saved before calls had ids.
    id: z.string().optional(),
    // The model step that made the call; a step can make several.
    step: z.int(),
    tool: z.string(),
    args: json,
    ok: z.boolean(),
    summary: z.string(),
    ms: z.int(),
    resultTokens: z.int(),
  })
  .meta({ id: 'ToolCall' });

export const conversationSchema = z
  .object({ id, workspaceId: id, title: z.string(), createdAt: date, updatedAt: date })
  .meta({ id: 'Conversation' });

export const messageSchema = z
  .object({
    id,
    role: z.enum(MessageRole),
    content: z.string(),
    citations: z.array(citationSchema),
    toolCalls: z.array(toolCallSchema),
    status: z.enum(MessageStatus),
    error: z.string().nullable(),
    feedback: z.enum(Feedback).nullable(),
    feedbackNote: z.string().nullable(),
    createdAt: date,
    // On answers, for the owner of the workspace they were asked in; left out for visitors of
    // the demo and on questions. What the turn used, as it was saved.
    model: z.string().nullable().optional(),
    latencyMs: z.int().nullable().optional(),
    firstTokenMs: z.int().nullable().optional(),
    tokensIn: z.int().optional(),
    tokensOut: z.int().optional(),
    tokensCached: z.int().optional(),
    costUsd: z.string().optional(),
    // Every search came back weak: the answer may rest on little.
    weakRetrieval: z.boolean().optional(),
  })
  .meta({ id: 'Message' });

export const conversationDetailSchema = conversationSchema
  .extend({ messages: page(messageSchema) })
  .meta({ id: 'ConversationDetail' });

const turnUsageSchema = z.object({
  tokensIn: z.int(),
  tokensOut: z.int(),
  tokensCached: z.int(),
  costUsd: z.string(),
});

// `event: <name>` then `data: <json>` per event; `: ping` comment lines keep it open.
const sseEvent = <T extends z.ZodType>(name: string, data: T, description: string) =>
  z.object({ event: z.literal(name), data }).meta({ description });

export const turnEventsSchema = z
  .discriminatedUnion('event', [
    sseEvent(
      'title',
      z.object({ title: z.string() }),
      'The question named the conversation, which had the default name. Sent first, once; the ' +
        'title model may replace the name later, after the first answer.',
    ),
    sseEvent(
      'step',
      z.object({
        // Unique within the turn, the same on the start and the end event and in the saved
        // message.
        id: z.string(),
        // The model step that made the call; a step can make several calls.
        index: z.int(),
        tool: z.string(),
        args: json,
        status: z.enum(['start', 'end']),
        // The next three come with `end`.
        ms: z.int().optional(),
        summary: z.string().optional(),
        // The tool ran without failing; false when it was refused or threw.
        ok: z.boolean().optional(),
      }),
      'A tool call started or ended.',
    ),
    sseEvent('token', z.object({ text: z.string() }), 'The next piece of the answer.'),
    sseEvent(
      'citations',
      z.object({ items: z.array(citationSchema) }),
      'What each [n] in the answer points at, after the check. Sent once, before done.',
    ),
    sseEvent(
      'done',
      z.object({
        messageId: id,
        usage: turnUsageSchema,
        latencyMs: z.int(),
        // The answer came from the demo's cache of a visitor's earlier question; no model ran.
        cached: z.boolean(),
      }),
      'The answer is saved. Last event.',
    ),
    sseEvent(
      'error',
      z.object({ code: z.string(), message: z.string() }),
      'The turn failed; what was written so far is saved. Last event.',
    ),
  ])
  .meta({
    id: 'TurnEvents',
    description:
      'Server-Sent Events, one per block: `event: <event>` and `data: <JSON of data>`. ' +
      'Order: title (when the question named the conversation), step and token events as the ' +
      'agent works, then citations and done, or error.',
  });

const sourceProgressSchema = z.object({
  status: z.enum(SourceStatus),
  stage: z.enum(IngestStage),
  progress: z.int(),
  error: z.string().nullable(),
});

export const sourceEventsSchema = z
  .discriminatedUnion('event', [
    sseEvent('progress', sourceProgressSchema, 'The status, stage or progress changed.'),
    sseEvent('done', sourceProgressSchema, 'The source is READY. Last event.'),
    sseEvent('failed', sourceProgressSchema, 'Ingestion FAILED. Last event.'),
    sseEvent('deleted', z.object({}), 'The source was deleted. Last event.'),
    sseEvent('error', z.object({ message: z.string() }), 'Progress is unavailable. Last event.'),
  ])
  .meta({
    id: 'SourceEvents',
    description:
      'Server-Sent Events, one per block: `event: <event>` and `data: <JSON of data>`. ' +
      'The current state comes first, then every change until a last event.',
  });

export const graphSymbolSchema = z
  .object({
    id,
    name: z.string(),
    qualifiedName: z.string(),
    kind: z.string(),
    filePath: z.string(),
    lineStart: z.int(),
    lineEnd: z.int(),
    signature: z.string().nullable(),
    exported: z.boolean(),
    chunkId: z.string().nullable(),
  })
  .meta({ id: 'GraphSymbol' });

const reachedSymbolSchema = graphSymbolSchema.extend({
  depth: z.int(),
  // The symbol it was reached through; null when reached straight from the start.
  via: z.string().nullable(),
});

export const graphWalkSchema = z
  .object({
    symbol: graphSymbolSchema,
    symbols: z.array(reachedSymbolSchema),
    truncated: z.boolean(),
  })
  .meta({ id: 'GraphWalk' });

export const graphDependenciesSchema = graphWalkSchema
  .extend({
    // Edges to targets outside the repository (packages, builtins), by name.
    external: z.array(
      z.object({
        fromSymbolId: id,
        toName: z.string(),
        type: z.enum(EdgeType),
        filePath: z.string(),
        line: z.int(),
      }),
    ),
  })
  .meta({ id: 'GraphDependencies' });

export const graphOverviewSchema = z
  .object({
    // The symbols with the most resolved calls in and out, files aside. A constructor counts
    // with its class.
    topSymbols: z.array(graphSymbolSchema.extend({ callers: z.int(), calls: z.int() })),
    // The files with the most symbols.
    files: z.array(z.object({ path: z.string(), symbols: z.int() })),
    // Packages the code calls into, by number of calls (names read from the files' imports).
    packages: z.array(z.object({ name: z.string(), calls: z.int() })),
  })
  .meta({ id: 'GraphOverview' });

export const graphPathSchema = z
  .object({
    from: graphSymbolSchema,
    to: graphSymbolSchema,
    path: z.array(graphSymbolSchema).nullable(),
    truncated: z.boolean(),
  })
  .meta({ id: 'GraphPath' });

export const searchResultSchema = z
  .object({
    results: z.array(
      z.object({
        chunkId: id,
        parentId: z.string().nullable(),
        sourceId: id,
        sourceTitle: z.string(),
        sourceType: z.enum(SourceType),
        documentPath: z.string(),
        headingPath: z.array(z.string()),
        symbolName: z.string().nullable(),
        pageStart: z.int().nullable(),
        pageEnd: z.int().nullable(),
        lineStart: z.int().nullable(),
        lineEnd: z.int().nullable(),
        content: z.string(),
        // The contextual line written for the chunk at ingest, when there is one.
        context: z.string().nullable(),
        scores: z.object({
          vector: z.number().optional(),
          keyword: z.number().optional(),
          rrf: z.number().optional(),
          rerank: z.number().optional(),
        }),
      }),
    ),
    // The parent sections around the results (when expandParents is on).
    parents: z.array(
      z.object({
        parentId: id,
        sourceId: id,
        sourceTitle: z.string(),
        documentPath: z.string(),
        headingPath: z.array(z.string()),
        content: z.string(),
        tokenCount: z.int(),
        childIds: z.array(z.string()),
        score: z.number(),
      }),
    ),
    // How the search went: stage timings, candidates, the rerank state.
    debug: z.record(z.string(), json),
  })
  .meta({ id: 'SearchResult' });

export const memorySchema = z
  .object({
    id,
    kind: z.enum(MemoryKind),
    content: z.string(),
    importance: z.int(),
    sourceMessageId: z.string().nullable(),
    lastUsedAt: date.nullable(),
    deletedAt: date.nullable(),
    createdAt: date,
    updatedAt: date,
  })
  .meta({ id: 'Memory' });

export const studySchema = z
  .object({
    id,
    workspaceId: id,
    type: z.enum(StudyType),
    title: z.string(),
    status: z.enum(JobStatus),
    // The request it was made from, minus the type.
    input: z.object({
      sourceIds: z.array(id),
      tocNodeId: z.string().optional(),
      pathPrefix: z.string().optional(),
      topic: z.string().optional(),
      count: z.int().optional(),
      difficulty: z.enum(['easy', 'medium', 'hard']),
    }),
    // A FAILED set: why, in words a user can read.
    error: z.string().nullable(),
    // Why, as a code. A set the owner stopped is FAILED with CANCELLED. Null unless FAILED.
    errorCode: z.enum(STUDY_ERROR_CODES).nullable(),
    model: z.string().nullable(),
    promptVersion: z.string().nullable(),
    createdAt: date,
    updatedAt: date,
  })
  .meta({ id: 'Study' });

export const studyDetailSchema = studySchema
  .extend({
    // The quiz questions, flashcards, summary or concept map; shape by type.
    data: json,
    sources: z.array(citationSchema.omit({ valid: true, supported: true })),
  })
  .meta({ id: 'StudyDetail' });

const usageWindowSchema = z.object({
  messages: z.int(),
  tokensIn: z.int(),
  tokensOut: z.int(),
  costUsd: z.string(),
});

const remainingSchema = z.object({ limit: z.int(), remaining: z.int() });

export const usageSchema = z
  .object({
    today: usageWindowSchema,
    last7Days: usageWindowSchema,
    last30Days: usageWindowSchema,
    sources: z.int(),
    storage: z.object({ pdfBytes: z.int(), limitBytes: z.int() }),
    limits: z.object({
      messagesThisHour: remainingSchema,
      messagesToday: remainingSchema,
      tokensToday: remainingSchema,
    }),
    // A guest's question allowance for the demo, counted per IP address; null for signed-up
    // users. `used` stops at `limit`.
    guest: z.object({ limit: z.int(), used: z.int(), resetsAt: date }).nullable(),
  })
  .meta({ id: 'Usage' });

const percentiles = z.object({ p50: z.int().nullable(), p95: z.int().nullable() });
const rate = z.number().nullable();

export const monitoringStatsSchema = z
  .object({
    from: date,
    to: date,
    answers: z.object({
      count: z.int(),
      latencyMs: percentiles,
      firstTokenMs: percentiles,
      retrievalMs: percentiles,
      errorRate: rate,
      thumbsDownRate: rate,
      invalidCitationRate: rate,
      weakRetrievalRate: rate,
    }),
    usagePerDay: z.array(
      z.object({
        day: z.string(),
        calls: z.int(),
        tokensIn: z.int(),
        tokensOut: z.int(),
        costUsd: z.string(),
      }),
    ),
    providers: z.object({
      fallbackRate: rate,
      errorRate: rate,
      byProvider: z.array(
        z.object({
          provider: z.string(),
          calls: z.int(),
          errorRate: rate,
          fallbackRate: rate,
        }),
      ),
    }),
    ingestion: z.object({
      ready: z.int(),
      failed: z.int(),
      inProgress: z.int(),
      successRate: rate,
      avgSeconds: z.int().nullable(),
    }),
  })
  .meta({ id: 'MonitoringStats' });

export const failedQuerySchema = z
  .object({
    messageId: id,
    conversationId: id,
    workspaceId: id,
    userId: id,
    createdAt: date,
    question: z.string().nullable(),
    answerExcerpt: z.string(),
    reasons: z.array(z.enum(['thumbs_down', 'error', 'invalid_citations', 'weak_retrieval'])),
    error: z.string().nullable(),
    feedbackNote: z.string().nullable(),
    invalidCitations: z.int(),
  })
  .meta({ id: 'FailedQuery' });

const modelUseFields = {
  calls: z.int(),
  errors: z.int(),
  // Model calls answered by a fallback model or key after the first choice failed.
  fallbacks: z.int(),
  tokensIn: z.int(),
  tokensOut: z.int(),
  costUsd: z.string(),
};

export const modelUsageSchema = z
  .object({
    from: date,
    to: date,
    // By model and the key it was called with (null for the main key), busiest first.
    models: z.array(
      z.object({
        type: z.enum(UsageType),
        provider: z.string(),
        model: z.string(),
        key: z.string().nullable(),
        ...modelUseFields,
      }),
    ),
    // By task: agent, cheap, contextualize, embed...
    tasks: z.array(z.object({ task: z.string(), ...modelUseFields })),
  })
  .meta({ id: 'ModelUsage' });

export const ingestionFailureSchema = z
  .object({
    sourceId: id,
    workspaceId: id,
    userId: id,
    title: z.string(),
    type: z.enum(SourceType),
    // Where in the pipeline it stopped.
    stage: z.enum(IngestStage),
    error: z.string().nullable(),
    failedAt: date,
  })
  .meta({ id: 'IngestionFailure' });

export const rateLimitUseSchema = z
  .object({
    from: date,
    to: date,
    limits: z.array(
      z.object({
        name: z.string(),
        points: z.int(),
        // Null for a limit that counts a calendar month.
        windowSec: z.int().nullable(),
        requests: z.int(),
        // Requests past the limit, which were turned away.
        blocked: z.int(),
        // Different clients (users, or IP addresses for guests) that went past it.
        clientsBlocked: z.int(),
      }),
    ),
  })
  .meta({
    id: 'RateLimitUse',
    description:
      'Counters are deleted a couple of days after their window ends, so older ranges are empty.',
  });

export const circuitBreakerSchema = z
  .object({
    // A model with this many quota errors inside `windowMs` is skipped for `coolOffMs`.
    quotaErrors: z.int(),
    windowMs: z.int(),
    coolOffMs: z.int(),
    // Every model a task can use. The state is this server process's own: it is not shared
    // between instances and starts empty after a restart.
    models: z.array(
      z.object({
        model: z.string(),
        open: z.boolean(),
        openUntil: date.nullable(),
        recentQuotaErrors: z.int(),
      }),
    ),
  })
  .meta({ id: 'CircuitBreaker' });

export const evalsStatusSchema = z
  .object({
    // False when no eval worker is connected to this deployment: POST /evals/runs answers 503.
    canStartRuns: z.boolean(),
    reason: z.string().nullable(),
  })
  .meta({ id: 'EvalsStatus' });

export const evalDatasetSchema = z
  .object({
    id,
    name: z.string(),
    description: z.string().nullable(),
    createdAt: date,
    cases: z.int(),
    bySplit: z.record(z.string(), z.int()),
    byType: z.record(z.string(), z.int()),
  })
  .meta({ id: 'EvalDataset' });

export const evalRunSchema = z
  .object({
    id,
    dataset: z.string(),
    suite: z.string(),
    name: z.string(),
    split: z.enum(EvalSplit),
    status: z.enum(EvalRunStatus),
    gitSha: z.string().nullable(),
    startedAt: date,
    finishedAt: date.nullable(),
    costUsd: z.string(),
    // The summary's overall metrics; their names differ by suite.
    overall: z.record(z.string(), json).nullable(),
    notes: z.string().nullable(),
  })
  .meta({ id: 'EvalRun' });

export const evalRunDetailSchema = evalRunSchema
  .extend({
    config: json,
    promptVersions: json,
    models: json,
    summary: json,
    counts: json,
  })
  .meta({ id: 'EvalRunDetail' });

export const evalResultSchema = z
  .object({
    id,
    caseId: id,
    externalId: z.string(),
    type: z.enum(EvalCaseType),
    split: z.enum(EvalSplit),
    question: z.string(),
    expectedAnswer: z.string(),
    expectedRefs: json,
    tags: z.array(z.string()),
    reviewed: z.boolean(),
    origin: z.enum(EvalCaseOrigin),
    // Has an error, or scored short of full marks.
    failed: z.boolean(),
    // 0 to 1: recall@5 for retrieval, correctness for answers. Null when not scored.
    score: z.number().nullable(),
    scores: json,
    error: z.string().nullable(),
    answer: z.string().nullable(),
    citations: json,
    retrieved: json,
    toolTrajectory: json,
    latencyMs: z.int(),
    tokensIn: z.int(),
    tokensOut: z.int(),
    costUsd: z.string(),
  })
  .meta({ id: 'EvalResult' });

const deltaSchema = z.object({
  a: z.number().nullable(),
  b: z.number().nullable(),
  delta: z.number().nullable(),
});

export const evalComparisonSchema = z
  .object({
    suite: z.string(),
    runs: z.object({ a: evalRunSchema, b: evalRunSchema }),
    overall: z.record(z.string(), deltaSchema),
    byType: z.record(z.string(), z.record(z.string(), deltaSchema)),
    counts: z.record(z.string(), z.int()),
    // Cases whose result changed between the runs (fixed, broke, better, worse, only-a/b).
    cases: z.array(z.record(z.string(), json)),
  })
  .meta({ id: 'EvalComparison' });

export const evalRunQueuedSchema = z
  .object({
    suite: z.string(),
    config: z.string(),
    dataset: z.string(),
    split: z.enum(EvalSplit),
    limit: z.int().optional(),
    tags: z.array(z.string()).optional(),
    resume: z.string().optional(),
    status: z.literal('queued'),
  })
  .meta({ id: 'EvalRunQueued' });

export const authUserSchema = z
  .object({
    id,
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    image: z.string().nullable().optional(),
    isGuest: z.boolean(),
    isSystem: z.boolean(),
    isAnonymous: z.boolean().nullable().optional(),
    createdAt: date,
    updatedAt: date,
  })
  .meta({ id: 'AuthUser' });

export const authSessionSchema = z
  .object({
    session: z.object({
      id,
      userId: id,
      expiresAt: date,
      createdAt: date,
      updatedAt: date,
      ipAddress: z.string().nullable().optional(),
      userAgent: z.string().nullable().optional(),
    }),
    user: authUserSchema,
  })
  .meta({ id: 'AuthSession' });
