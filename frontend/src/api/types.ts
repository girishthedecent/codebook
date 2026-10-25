// Named types over the generated OpenAPI schema, so features never import `schema.d.ts` directly.
import type { components, paths } from './schema';

export type Schemas = components['schemas'];

type Json<R> = R extends { content: { 'application/json': infer B } } ? B : never;
type Data<R> = Json<R> extends { data: infer D } ? D : void;
type Success<R> = R extends { 200: infer A }
  ? Data<A>
  : R extends { 201: infer A }
    ? Data<A>
    : R extends { 204: unknown }
      ? void
      : never;

/** The `data` of a route's success response. */
export type Res<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: infer R;
}
  ? Success<R>
  : never;

/** A route's JSON request body. */
export type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** A route's query parameters. */
export type Query<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  parameters: { query?: infer Q };
}
  ? NonNullable<Q>
  : never;

export type Page<T> = { items: T[]; nextCursor: string | null };

export type Me = Schemas['Me'] & {
  // Added to /me by the backend for the admin pages; older servers don't send it.
  isAdmin?: boolean;
};
export type Workspace = Schemas['Workspace'];
export type WorkspaceDetail = Schemas['WorkspaceDetail'];
export type WorkspaceSettings = Schemas['WorkspaceSettings'];
export type Source = Schemas['Source'];
export type SourceType = Source['type'];
export type SourceStatus = Source['status'];
export type SourceStage = Source['stage'];
export type SourceFile = Schemas['SourceFile'];
export type SourceContent = Schemas['SourceContent'];
export type TocNode = Schemas['TocNode'];
export type GraphSymbol = Schemas['GraphSymbol'];
export type GraphWalk = Schemas['GraphWalk'];
export type GraphDependencies = Schemas['GraphDependencies'];
export type GraphPath = Schemas['GraphPath'];
export type SearchResult = Schemas['SearchResult'];
export type SearchHit = SearchResult['results'][number];
export type Conversation = Schemas['Conversation'];
export type ConversationDetail = Schemas['ConversationDetail'];
export type Message = Schemas['Message'];
export type Citation = Schemas['Citation'];
export type ToolCall = Schemas['ToolCall'];
export type Memory = Schemas['Memory'];
export type Study = Schemas['Study'];
export type StudyDetail = Schemas['StudyDetail'];
export type StudyType = Study['type'];
export type Usage = Schemas['Usage'];
export type Demo = Schemas['Demo'];
export type EvalDataset = Schemas['EvalDataset'];
export type EvalRun = Schemas['EvalRun'];
export type EvalRunDetail = Schemas['EvalRunDetail'];
export type EvalResult = Schemas['EvalResult'];
export type EvalComparison = Schemas['EvalComparison'];
export type EvalRunQueued = Schemas['EvalRunQueued'];
export type MonitoringStats = Schemas['MonitoringStats'];
export type FailedQuery = Schemas['FailedQuery'];

// Server-sent events, discriminated on `event`.
export type TurnEvent = Schemas['TurnEvents'];
export type TurnStep = Extract<TurnEvent, { event: 'step' }>['data'];
export type TurnDone = Extract<TurnEvent, { event: 'done' }>['data'];
export type SourceEvent = Schemas['SourceEvents'];
export type SourceProgress = Extract<SourceEvent, { event: 'progress' }>['data'];

export type CreateWorkspaceBody = Body<'/api/v1/workspaces', 'post'>;
export type UpdateWorkspaceBody = Body<'/api/v1/workspaces/{workspaceId}', 'patch'>;
export type CreateSourceBody = Body<'/api/v1/workspaces/{workspaceId}/sources', 'post'>;
export type SearchBody = Body<'/api/v1/workspaces/{workspaceId}/search', 'post'>;
export type SendMessageBody = Body<'/api/v1/conversations/{conversationId}/messages', 'post'>;
export type FeedbackBody = Body<'/api/v1/messages/{messageId}/feedback', 'post'>;
export type CreateMemoryBody = Body<'/api/v1/memories', 'post'>;
export type UpdateMemoryBody = Body<'/api/v1/memories/{memoryId}', 'patch'>;
export type CreateStudyBody = Body<'/api/v1/workspaces/{workspaceId}/study', 'post'>;
export type StartEvalRunBody = Body<'/api/v1/evals/runs', 'post'>;

export type ContentQuery = Query<'/api/v1/sources/{sourceId}/content', 'get'>;
export type FilesQuery = Query<'/api/v1/sources/{sourceId}/files', 'get'>;
export type MemoriesQuery = Query<'/api/v1/memories', 'get'>;
export type StudyListQuery = Query<'/api/v1/workspaces/{workspaceId}/study', 'get'>;
export type EvalRunsQuery = Query<'/api/v1/evals/runs', 'get'>;
export type EvalResultsQuery = Query<'/api/v1/evals/runs/{runId}/results', 'get'>;
export type StatsQuery = Query<'/api/v1/monitoring/stats', 'get'>;
