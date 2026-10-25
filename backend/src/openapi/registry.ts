import {
  OpenApiGeneratorV31,
  OpenAPIRegistry,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { appConfig } from '../config/app.config.js';
import {
  conversationMessagesQuerySchema,
  conversationParamsSchema,
  createConversationSchema,
  feedbackSchema,
  listConversationsQuerySchema,
  messageParamsSchema,
  updateConversationSchema,
} from '../modules/chat/conversation.validator.js';
import { sendMessageSchema } from '../modules/chat/turn.validator.js';
import {
  compareQuerySchema,
  createRunSchema,
  listRunsQuerySchema,
  resultsQuerySchema,
  runParamsSchema,
} from '../modules/evals/evals.validator.js';
import {
  dependenciesQuerySchema,
  pathQuerySchema,
  symbolsQuerySchema,
  walkQuerySchema,
} from '../modules/graph/graph.validator.js';
import {
  createMemorySchema,
  listMemoriesQuerySchema,
  memoryParamsSchema,
  updateMemorySchema,
} from '../modules/memory/memory.validator.js';
import {
  failedQueriesQuerySchema,
  statsQuerySchema,
} from '../modules/monitoring/monitoring.validator.js';
import { searchBodySchema } from '../modules/retrieval/retrieval.validator.js';
import {
  createSourceSchema,
  listFilesQuerySchema,
  listSourcesQuerySchema,
  sourceContentQuerySchema,
  sourceParamsSchema,
  uploadFieldsSchema,
} from '../modules/sources/source.validator.js';
import {
  createStudySchema,
  listStudyQuerySchema,
  studyParamsSchema,
} from '../modules/study/study.validator.js';
import {
  createWorkspaceSchema,
  listWorkspacesQuerySchema,
  updateWorkspaceSchema,
  workspaceParamsSchema,
} from '../modules/workspaces/workspace.validator.js';
import * as s from './schemas.js';

// The API as OpenAPI 3.1, served at /openapi.json and rendered at /docs. Request schemas
// are the validators the routes run; responses are described in ./schemas.ts.
// tests/openapi.test.ts checks every mounted route is here and nothing here is missing a route.

// Who may call a route. Admin routes answer 404, not 403, to everyone else.
type Access = 'public' | 'user' | 'admin';

type Route = Omit<RouteConfig, 'responses' | 'security'> & {
  access: Access;
  responses?: RouteConfig['responses'];
  // Error statuses this route can answer with, besides the ones its access implies.
  errors?: number[];
};

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid request (the details list each issue)',
  401: 'Not signed in',
  403: 'Not allowed (e.g. a guest, or writing to the demo workspace)',
  404: 'Not found, or not yours',
  409: 'Conflicts with the current state',
  413: 'Too large',
  415: 'Unsupported file type',
  429: 'Rate limit or quota reached (see Retry-After)',
  502: 'An upstream provider failed',
  503: 'Not ready',
};

const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const pdfBinary = z.string().meta({ format: 'binary', description: 'PDF bytes' });

export const API = '/api/v1';
export const AUTH = '/api/auth';

function errorResponses(codes: number[]) {
  return Object.fromEntries(
    [...new Set(codes)]
      .sort((a, b) => a - b)
      .map((code) => [
        code,
        { description: ERROR_DESCRIPTIONS[code] ?? 'Error', content: json(s.errorSchema) },
      ]),
  );
}

function ok(description: string, data?: z.ZodType) {
  return data ? { description, content: json(s.success(data)) } : { description };
}

const sse = (description: string, schema: z.ZodType) => ({
  description,
  content: { 'text/event-stream': { schema } },
});

const ADMIN_NOTE =
  'Admins only (ADMIN_USER_IDS). Anyone else gets a 404, as if the route did not exist.';

function register(registry: OpenAPIRegistry, route: Route) {
  const { access, errors = [], responses = {}, ...config } = route;
  const implied = access === 'public' ? [] : access === 'admin' ? [404] : [401];
  registry.registerPath({
    ...config,
    description:
      access === 'admin'
        ? [config.description, ADMIN_NOTE].filter(Boolean).join('\n\n')
        : config.description,
    tags: access === 'admin' ? [...(config.tags ?? []), 'admin'] : config.tags,
    // The document's default is the session cookie; public routes need none.
    ...(access === 'public' ? { security: [] } : {}),
    responses: { ...responses, ...errorResponses([...implied, ...errors]) },
  });
}

function apiRoutes(): Route[] {
  const workspace = `${API}/workspaces/{workspaceId}`;
  const source = `${API}/sources/{sourceId}`;
  const graph = `${source}/graph`;
  const workspaceParams = { params: workspaceParamsSchema };
  const sourceParams = { params: sourceParamsSchema };

  return [
    // Health
    {
      method: 'get',
      path: `${API}/health/live`,
      tags: ['health'],
      summary: 'Liveness: the process is up',
      access: 'public',
      responses: { 200: ok('Up', s.livenessSchema) },
    },
    {
      method: 'get',
      path: `${API}/health/ready`,
      tags: ['health'],
      summary: 'Readiness: the database is reachable',
      access: 'public',
      responses: {
        200: ok('Ready', s.readinessSchema),
        503: {
          description: 'A dependency is down; data says which',
          content: json(s.errorSchema.extend({ data: s.readinessSchema })),
        },
      },
    },

    // Me and usage
    {
      method: 'get',
      path: `${API}/me`,
      tags: ['account'],
      summary: 'The signed-in user',
      access: 'user',
      responses: { 200: ok('The user', s.meSchema) },
    },
    {
      method: 'get',
      path: `${API}/usage/me`,
      tags: ['account'],
      summary: "Today's, this week's and this month's usage, and what is left of each limit",
      access: 'user',
      responses: { 200: ok('Usage', s.usageSchema) },
    },

    // Demo
    {
      method: 'get',
      path: `${API}/demo`,
      tags: ['demo'],
      summary: 'The public demo workspace and its sources',
      description:
        'No sign-in needed. Sign in as a guest (POST /api/auth/sign-in/anonymous) to ask it ' +
        'questions: guests can only open conversations in this workspace.',
      access: 'public',
      responses: { 200: ok('The demo', s.demoSchema) },
      errors: [404],
    },

    // Workspaces
    {
      method: 'get',
      path: `${API}/workspaces`,
      tags: ['workspaces'],
      summary: 'Your workspaces, newest first (the demo workspace included)',
      access: 'user',
      request: { query: listWorkspacesQuerySchema },
      responses: { 200: ok('A page of workspaces', s.page(s.workspaceSchema)) },
      errors: [400],
    },
    {
      method: 'post',
      path: `${API}/workspaces`,
      tags: ['workspaces'],
      summary: 'Create a workspace',
      access: 'user',
      request: { body: { content: json(createWorkspaceSchema) } },
      responses: { 201: ok('Created', s.workspaceSchema) },
      // 409: the per-user workspace limit is reached.
      errors: [400, 403, 409],
    },
    {
      method: 'get',
      path: workspace,
      tags: ['workspaces'],
      summary: 'A workspace, with source and conversation counts',
      access: 'user',
      request: workspaceParams,
      responses: { 200: ok('The workspace', s.workspaceDetailSchema) },
      errors: [400, 404],
    },
    {
      method: 'patch',
      path: workspace,
      tags: ['workspaces'],
      summary: 'Rename a workspace or change its settings',
      access: 'user',
      request: { ...workspaceParams, body: { content: json(updateWorkspaceSchema) } },
      responses: { 200: ok('Updated', s.workspaceSchema) },
      errors: [400, 403, 404],
    },
    {
      method: 'delete',
      path: workspace,
      tags: ['workspaces'],
      summary: 'Delete a workspace and everything in it',
      access: 'user',
      request: workspaceParams,
      responses: { 204: ok('Deleted') },
      errors: [400, 403, 404],
    },
    {
      method: 'post',
      path: `${workspace}/search`,
      tags: ['retrieval'],
      summary: 'Search the workspace (debug view of what the agent retrieves)',
      description:
        'Hybrid vector + keyword search with optional query rewriting and reranking. On the ' +
        'demo workspace, visitors get short snippets and no parent sections.',
      access: 'user',
      request: { ...workspaceParams, body: { content: json(searchBodySchema) } },
      responses: { 200: ok('Results', s.searchResultSchema) },
      errors: [400, 404, 429, 502],
    },

    // Sources
    {
      method: 'get',
      path: `${workspace}/sources`,
      tags: ['sources'],
      summary: "The workspace's sources, newest first",
      access: 'user',
      request: { ...workspaceParams, query: listSourcesQuerySchema },
      responses: { 200: ok('A page of sources', s.page(s.sourceSchema)) },
      errors: [400, 404],
    },
    {
      method: 'post',
      path: `${workspace}/sources`,
      tags: ['sources'],
      summary: 'Add a source: a GitHub repository, a website, or a PDF upload',
      description:
        'JSON for a repository or a website; multipart/form-data with a `file` field for a ' +
        `PDF (at most ${Math.round(appConfig.sources.maxPdfBytes / 1024 / 1024)} MB). ` +
        'Ingestion runs in the background: follow it on GET /sources/{sourceId}/events.',
      access: 'user',
      request: {
        ...workspaceParams,
        body: {
          content: {
            ...json(createSourceSchema),
            'multipart/form-data': {
              schema: uploadFieldsSchema.extend({
                file: z.string().meta({ format: 'binary', description: 'The PDF' }),
              }),
            },
          },
        },
      },
      responses: { 201: ok('Added; ingestion is queued', s.sourceSchema) },
      errors: [400, 403, 404, 409, 413, 415, 429],
    },
    {
      method: 'get',
      path: source,
      tags: ['sources'],
      summary: 'A source and its ingestion state',
      access: 'user',
      request: sourceParams,
      responses: { 200: ok('The source', s.sourceSchema) },
      errors: [400, 404],
    },
    {
      method: 'delete',
      path: source,
      tags: ['sources'],
      summary: 'Delete a source and its index',
      access: 'user',
      request: sourceParams,
      responses: { 204: ok('Deleted') },
      errors: [400, 403, 404],
    },
    {
      method: 'post',
      path: `${source}/resync`,
      tags: ['sources'],
      summary: 'Ingest the source again (new commits, changed pages, a failed run)',
      access: 'user',
      request: sourceParams,
      responses: { 202: ok('Queued', s.sourceSchema) },
      errors: [400, 403, 404, 409, 429],
    },
    {
      method: 'get',
      path: `${source}/events`,
      tags: ['sources'],
      summary: 'Ingestion progress as Server-Sent Events',
      access: 'user',
      request: sourceParams,
      responses: { 200: sse('The event stream', s.sourceEventsSchema) },
      errors: [400, 404, 429],
    },
    {
      method: 'get',
      path: `${source}/toc`,
      tags: ['sources'],
      summary: 'The table of contents as a tree (books and docs)',
      access: 'user',
      request: sourceParams,
      responses: { 200: ok('The tree', z.array(s.tocNodeSchema)) },
      errors: [400, 404],
    },
    {
      method: 'get',
      path: `${source}/files`,
      tags: ['sources'],
      summary: 'The files (or pages) of a source, in path order',
      access: 'user',
      request: { ...sourceParams, query: listFilesQuerySchema },
      responses: { 200: ok('A page of files', s.page(s.sourceFileSchema)) },
      errors: [400, 404],
    },
    {
      method: 'get',
      path: `${source}/content`,
      tags: ['sources'],
      summary: 'Read a page, a TOC section, or lines of a file',
      access: 'user',
      request: { ...sourceParams, query: sourceContentQuerySchema },
      responses: { 200: ok('The text', s.sourceContentSchema) },
      errors: [400, 404, 429],
    },
    {
      method: 'get',
      path: `${source}/file`,
      tags: ['sources'],
      summary: 'The PDF itself, for the owner',
      description:
        'Only the workspace owner may read the file; everyone else (demo visitors included) gets a 404, and non-PDF sources have no file. Supports `Range: bytes=…` so a viewer can read page by page.',
      access: 'user',
      request: { ...sourceParams, headers: z.object({ range: z.string().optional() }) },
      responses: {
        200: {
          description: 'The whole file',
          content: { 'application/pdf': { schema: pdfBinary } },
        },
        206: {
          description: 'The requested part of the file',
          content: { 'application/pdf': { schema: pdfBinary } },
        },
      },
      errors: [404],
    },

    // Code graph
    {
      method: 'get',
      path: `${graph}/symbols`,
      tags: ['graph'],
      summary: 'Find symbols by name (repositories)',
      access: 'user',
      request: { ...sourceParams, query: symbolsQuerySchema },
      responses: { 200: ok('Matching symbols', z.array(s.graphSymbolSchema)) },
      errors: [400, 404],
    },
    {
      method: 'get',
      path: `${graph}/callers`,
      tags: ['graph'],
      summary: 'Who calls a symbol, up to `depth` hops back',
      access: 'user',
      request: { ...sourceParams, query: walkQuerySchema },
      responses: { 200: ok('Callers', s.graphWalkSchema) },
      errors: [400, 404],
    },
    {
      method: 'get',
      path: `${graph}/dependencies`,
      tags: ['graph'],
      summary: 'What a symbol calls or imports, up to `depth` hops',
      access: 'user',
      request: { ...sourceParams, query: dependenciesQuerySchema },
      responses: { 200: ok('Dependencies', s.graphDependenciesSchema) },
      errors: [400, 404],
    },
    {
      method: 'get',
      path: `${graph}/path`,
      tags: ['graph'],
      summary: 'The shortest call chain from one symbol to another',
      access: 'user',
      request: { ...sourceParams, query: pathQuerySchema },
      responses: { 200: ok('The chain, or null when there is none', s.graphPathSchema) },
      errors: [400, 404],
    },

    // Conversations
    {
      method: 'get',
      path: `${workspace}/conversations`,
      tags: ['chat'],
      summary: 'Your conversations in a workspace, recently updated first',
      access: 'user',
      request: { ...workspaceParams, query: listConversationsQuerySchema },
      responses: { 200: ok('A page of conversations', s.page(s.conversationSchema)) },
      errors: [400, 404],
    },
    {
      method: 'post',
      path: `${workspace}/conversations`,
      tags: ['chat'],
      summary: 'Start a conversation',
      description: 'Guests can only start conversations in the demo workspace.',
      access: 'user',
      request: { ...workspaceParams, body: { content: json(createConversationSchema) } },
      responses: { 201: ok('Created', s.conversationSchema) },
      errors: [400, 403, 404],
    },
    {
      method: 'get',
      path: `${API}/conversations/{conversationId}`,
      tags: ['chat'],
      summary: 'A conversation with a page of its messages, newest first',
      access: 'user',
      request: { params: conversationParamsSchema, query: conversationMessagesQuerySchema },
      responses: { 200: ok('The conversation', s.conversationDetailSchema) },
      errors: [400, 404],
    },
    {
      method: 'patch',
      path: `${API}/conversations/{conversationId}`,
      tags: ['chat'],
      summary: 'Rename a conversation',
      access: 'user',
      request: {
        params: conversationParamsSchema,
        body: { content: json(updateConversationSchema) },
      },
      responses: { 200: ok('Updated', s.conversationSchema) },
      errors: [400, 404],
    },
    {
      method: 'delete',
      path: `${API}/conversations/{conversationId}`,
      tags: ['chat'],
      summary: 'Delete a conversation',
      access: 'user',
      request: { params: conversationParamsSchema },
      responses: { 204: ok('Deleted') },
      errors: [400, 404],
    },
    {
      method: 'post',
      path: `${API}/conversations/{conversationId}/messages`,
      tags: ['chat'],
      summary: 'Ask a question; the answer streams back as Server-Sent Events',
      description:
        'The agent picks its tools (search, code search, the code graph, reading sources, ' +
        'web search) step by step, then answers with [n] citations. Errors before the stream ' +
        'opens (access, limits, the daily token budget) are ordinary JSON errors; once it is ' +
        'open, a failure is an `error` event.',
      access: 'user',
      request: {
        params: conversationParamsSchema,
        body: { content: json(sendMessageSchema) },
      },
      responses: { 200: sse('The answer as it is written', s.turnEventsSchema) },
      errors: [400, 404, 429],
    },
    {
      method: 'post',
      path: `${API}/messages/{messageId}/feedback`,
      tags: ['chat'],
      summary: 'Thumbs up or down on an answer',
      access: 'user',
      request: { params: messageParamsSchema, body: { content: json(feedbackSchema) } },
      responses: { 200: ok('Saved', s.messageSchema) },
      errors: [400, 404],
    },

    // Memory
    {
      method: 'get',
      path: `${API}/memories`,
      tags: ['memory'],
      summary: 'What CodeBook remembers about you',
      description: 'Not for guests (403).',
      access: 'user',
      request: { query: listMemoriesQuerySchema },
      responses: { 200: ok('Memories', z.object({ items: z.array(s.memorySchema) })) },
      errors: [400, 403],
    },
    {
      method: 'post',
      path: `${API}/memories`,
      tags: ['memory'],
      summary: 'Add a memory yourself',
      access: 'user',
      request: { body: { content: json(createMemorySchema) } },
      responses: { 201: ok('Added', s.memorySchema) },
      errors: [400, 403, 409, 429],
    },
    {
      method: 'delete',
      path: `${API}/memories`,
      tags: ['memory'],
      summary: 'Forget everything',
      access: 'user',
      responses: { 200: ok('Cleared', z.object({ deleted: z.int() })) },
      errors: [403],
    },
    {
      method: 'patch',
      path: `${API}/memories/{memoryId}`,
      tags: ['memory'],
      summary: 'Edit a memory',
      access: 'user',
      request: { params: memoryParamsSchema, body: { content: json(updateMemorySchema) } },
      responses: { 200: ok('Updated', s.memorySchema) },
      errors: [400, 403, 404, 409, 429],
    },
    {
      method: 'delete',
      path: `${API}/memories/{memoryId}`,
      tags: ['memory'],
      summary: 'Forget a memory (it can be restored)',
      access: 'user',
      request: { params: memoryParamsSchema },
      responses: { 204: ok('Deleted') },
      errors: [400, 403, 404],
    },
    {
      method: 'post',
      path: `${API}/memories/{memoryId}/restore`,
      tags: ['memory'],
      summary: 'Bring back a deleted memory',
      access: 'user',
      request: { params: memoryParamsSchema },
      responses: { 200: ok('Restored', s.memorySchema) },
      errors: [400, 403, 404, 409],
    },

    // Study
    {
      method: 'get',
      path: `${workspace}/study`,
      tags: ['study'],
      summary: "The workspace's study sets, newest first",
      access: 'user',
      request: { ...workspaceParams, query: listStudyQuerySchema },
      responses: { 200: ok('A page of study sets', s.page(s.studySchema)) },
      errors: [400, 404],
    },
    {
      method: 'post',
      path: `${workspace}/study`,
      tags: ['study'],
      summary: 'Generate a quiz, flashcards, a summary or a concept map',
      description: 'Generated in the background: poll GET /study/{studyId} until READY.',
      access: 'user',
      request: { ...workspaceParams, body: { content: json(createStudySchema) } },
      responses: { 202: ok('Queued', s.studySchema) },
      errors: [400, 403, 404, 429],
    },
    {
      method: 'get',
      path: `${API}/study/{studyId}`,
      tags: ['study'],
      summary: 'A study set with its items and what each citation points at',
      access: 'user',
      request: { params: studyParamsSchema },
      responses: { 200: ok('The study set', s.studyDetailSchema) },
      errors: [400, 404],
    },
    {
      method: 'delete',
      path: `${API}/study/{studyId}`,
      tags: ['study'],
      summary: 'Delete a study set',
      access: 'user',
      request: { params: studyParamsSchema },
      responses: { 204: ok('Deleted') },
      errors: [400, 404],
    },
    {
      method: 'post',
      path: `${API}/study/{studyId}/regenerate`,
      tags: ['study'],
      summary: 'Generate a study set again from the same request',
      access: 'user',
      request: { params: studyParamsSchema },
      responses: { 202: ok('Queued', s.studySchema) },
      errors: [400, 403, 404, 409, 429],
    },
    {
      method: 'post',
      path: `${API}/study/{studyId}/cancel`,
      tags: ['study'],
      summary: 'Stop a study set that is still generating',
      description: 'Marks it FAILED with the error "Cancelled."; 409 once it has finished.',
      access: 'user',
      request: { params: studyParamsSchema },
      responses: { 200: ok('Cancelled', s.studySchema) },
      errors: [400, 403, 404, 409],
    },

    // Monitoring (admin)
    {
      method: 'get',
      path: `${API}/monitoring/stats`,
      tags: ['monitoring'],
      summary: 'Answer quality, latency, provider and ingestion stats over a time range',
      access: 'admin',
      // The validator turns the strings into dates and checks the range, so describe its input.
      request: { query: statsQuerySchema.in },
      responses: { 200: ok('Stats', s.monitoringStatsSchema) },
      errors: [400],
    },
    {
      method: 'get',
      path: `${API}/monitoring/failed-queries`,
      tags: ['monitoring'],
      summary: 'Answers that failed: errors, thumbs down, invalid citations, weak retrieval',
      access: 'admin',
      request: { query: failedQueriesQuerySchema },
      responses: { 200: ok('A page of failed answers', s.page(s.failedQuerySchema)) },
      errors: [400],
    },

    // Evals (admin)
    {
      method: 'get',
      path: `${API}/evals/datasets`,
      tags: ['evals'],
      summary: 'Eval datasets and their case counts',
      access: 'admin',
      responses: { 200: ok('Datasets', z.array(s.evalDatasetSchema)) },
    },
    {
      method: 'get',
      path: `${API}/evals/runs`,
      tags: ['evals'],
      summary: 'Eval runs, newest first',
      access: 'admin',
      request: { query: listRunsQuerySchema },
      responses: { 200: ok('Runs', z.array(s.evalRunSchema)) },
      errors: [400],
    },
    {
      method: 'post',
      path: `${API}/evals/runs`,
      tags: ['evals'],
      summary: 'Queue an eval run on the eval worker',
      access: 'admin',
      request: { body: { content: json(createRunSchema) } },
      responses: { 202: ok('Queued', s.evalRunQueuedSchema) },
      errors: [400, 409],
    },
    {
      method: 'get',
      path: `${API}/evals/runs/{runId}`,
      tags: ['evals'],
      summary: 'A run with its config, models, prompt versions and summary',
      access: 'admin',
      request: { params: runParamsSchema },
      responses: { 200: ok('The run', s.evalRunDetailSchema) },
      errors: [400],
    },
    {
      method: 'get',
      path: `${API}/evals/runs/{runId}/results`,
      tags: ['evals'],
      summary: "A run's per-case results",
      access: 'admin',
      request: { params: runParamsSchema, query: resultsQuerySchema },
      responses: { 200: ok('Results', z.array(s.evalResultSchema)) },
      errors: [400],
    },
    {
      method: 'get',
      path: `${API}/evals/compare`,
      tags: ['evals'],
      summary: 'Two runs side by side: metric deltas and the cases that changed',
      access: 'admin',
      request: { query: compareQuerySchema },
      responses: { 200: ok('The comparison', s.evalComparisonSchema) },
      errors: [400],
    },
  ];
}

// better-auth's own routes that the API uses. They answer without the success envelope.
function authRoutes(): Route[] {
  const credentials = {
    email: z.email(),
    password: z.string().min(8),
    callbackURL: z.string().optional(),
    rememberMe: z.boolean().optional(),
  };
  const signedIn = {
    description: 'Signed in; the session cookie is set',
    content: json(z.object({ token: z.string().nullable(), user: s.authUserSchema })),
  };
  return [
    {
      method: 'post',
      path: `${AUTH}/sign-up/email`,
      tags: ['auth'],
      summary: 'Sign up with email and password',
      description:
        'Signs the new user in. An email that is already used answers 422 (better-auth), so ' +
        'sign-up can tell whether an email exists; rate limits are the mitigation.',
      access: 'public',
      request: {
        body: { content: json(z.object({ name: z.string().min(1), ...credentials })) },
      },
      responses: { 200: signedIn },
      errors: [400, 422, 429],
    },
    {
      method: 'post',
      path: `${AUTH}/sign-in/email`,
      tags: ['auth'],
      summary: 'Sign in with email and password',
      access: 'public',
      request: { body: { content: json(z.object(credentials)) } },
      responses: { 200: signedIn },
      errors: [400, 401, 429],
    },
    {
      method: 'post',
      path: `${AUTH}/sign-in/anonymous`,
      tags: ['auth', 'demo'],
      summary: 'Sign in as a guest, to ask the demo workspace questions',
      description:
        'Makes a throwaway guest account. Guests can only chat in the demo workspace, have no ' +
        'memory, and are deleted after ' +
        `${appConfig.demo.guestTtlDays} days. Limited per IP.`,
      access: 'public',
      responses: { 200: signedIn },
      errors: [400, 429],
    },
    {
      method: 'post',
      path: `${AUTH}/sign-in/social`,
      tags: ['auth'],
      summary: 'Start a GitHub sign-in',
      description: 'Answers with the GitHub URL to send the browser to.',
      access: 'public',
      request: {
        body: {
          content: json(
            z.object({ provider: z.literal('github'), callbackURL: z.string().optional() }),
          ),
        },
      },
      responses: {
        200: {
          description: 'Where to redirect',
          content: json(z.object({ url: z.string(), redirect: z.boolean() })),
        },
      },
      errors: [400, 404],
    },
    {
      method: 'get',
      path: `${AUTH}/callback/github`,
      tags: ['auth'],
      summary: 'GitHub redirects back here; sets the session cookie',
      access: 'public',
      request: { query: z.object({ code: z.string(), state: z.string() }) },
      responses: { 302: { description: 'To the callback URL given at the start' } },
    },
    {
      method: 'get',
      path: `${AUTH}/get-session`,
      tags: ['auth'],
      summary: 'The current session, or null',
      access: 'public',
      responses: {
        200: { description: 'The session', content: json(s.authSessionSchema.nullable()) },
      },
    },
    {
      method: 'post',
      path: `${AUTH}/sign-out`,
      tags: ['auth'],
      summary: 'Sign out',
      access: 'user',
      responses: {
        200: { description: 'Signed out', content: json(z.object({ success: z.boolean() })) },
      },
    },
  ];
}

function buildDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    // `__Secure-better-auth.session_token` in production (Secure cookies).
    name: 'better-auth.session_token',
    description: 'The session cookie set by sign-in.',
  });
  for (const route of [...apiRoutes(), ...authRoutes()]) register(registry, route);

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'CodeBook API',
      version: appConfig.version,
      description:
        'An adaptive agentic RAG workspace for books, docs and code. JSON responses are ' +
        '`{ success, message, data }`; errors are `{ success: false, message, code, details?, ' +
        'correlationId }`. Writes from a browser must come from a trusted origin.',
    },
    servers: [{ url: '/' }],
    security: [{ session: [] }],
    tags: [
      { name: 'auth', description: 'Sign-up, sign-in and sessions (better-auth)' },
      { name: 'demo', description: 'The public demo workspace and guest access' },
      { name: 'admin', description: 'Admins only; 404 for everyone else' },
    ],
  });
}

let document: ReturnType<typeof buildDocument> | undefined;

/** The OpenAPI document, built once on first use. */
export function openApiDocument() {
  document ??= buildDocument();
  return document;
}
