// Query keys in one place so mutations can invalidate exactly what they changed.
export const keys = {
  me: ['me'] as const,
  demo: ['demo'] as const,
  usage: ['usage'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  sources: (workspaceId: string) => ['sources', workspaceId] as const,
  source: (id: string) => ['source', id] as const,
  sourceFiles: (id: string, prefix?: string) => ['source', id, 'files', prefix ?? ''] as const,
  sourceToc: (id: string) => ['source', id, 'toc'] as const,
  sourceContent: (id: string, query: object) => ['source', id, 'content', query] as const,
  graph: (id: string, kind: string, query: object) => ['source', id, 'graph', kind, query] as const,
  search: (workspaceId: string, body: object) => ['search', workspaceId, body] as const,
  conversations: (workspaceId: string) => ['conversations', workspaceId] as const,
  conversation: (id: string) => ['conversation', id] as const,
  memories: (query: object) => ['memories', query] as const,
  studies: (workspaceId: string, type?: string) => ['studies', workspaceId, type ?? ''] as const,
  study: (id: string) => ['study', id] as const,
  evalDatasets: ['evals', 'datasets'] as const,
  evalRuns: (query: object) => ['evals', 'runs', query] as const,
  evalRun: (id: string) => ['evals', 'run', id] as const,
  evalResults: (id: string, query: object) => ['evals', 'run', id, 'results', query] as const,
  evalCompare: (runs: string[]) => ['evals', 'compare', runs] as const,
  monitoringStats: (query: object) => ['monitoring', 'stats', query] as const,
  failedQueries: ['monitoring', 'failed-queries'] as const,
};

/** Flattens an infinite query's pages into one list. */
export function flatItems<T>(data: { pages: { items: T[] }[] } | undefined): T[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}
