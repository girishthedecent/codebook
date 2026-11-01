import { api, isApiError, unwrap } from '@/api/client';
import type { Conversation, Me, Memory, Message, Page, SourceType, Workspace } from '@/api/types';
import { strings } from '@/features/account/strings';

const s = strings.settings.data;
const PAGE = 50;

/** A saved passage, as `GET /workspaces/:id/highlights` returns it. */
type Highlight = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: SourceType;
  page: number | null;
  path: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  heading: string | null;
  text: string;
  note: string | null;
  createdAt: string;
};

export type ExportFile = {
  exportedAt: string;
  account: Pick<Me, 'name' | 'email' | 'createdAt'>;
  workspaces: Array<
    Workspace & {
      conversations: Array<Conversation & { messages: Message[] }>;
      highlights?: Highlight[];
    }
  >;
  memories: Memory[];
};

export type ExportCounts = {
  workspaces: number;
  conversations: number;
  messages: number;
  memories: number;
  highlights: number;
};

/**
 * Reads everything the account can see through the ordinary endpoints, one request at a time
 * so a large account doesn't trip the rate limits, and reports each step as a line of text.
 */
export async function collectExport(
  me: Me,
  onProgress: (line: string) => void,
  signal: AbortSignal,
): Promise<{ file: ExportFile; counts: ExportCounts }> {
  const counts: ExportCounts = {
    workspaces: 0,
    conversations: 0,
    messages: 0,
    memories: 0,
    highlights: 0,
  };

  onProgress(s.progress.workspaces);
  const workspaces = await allPages((cursor) =>
    unwrap(api.GET('/api/v1/workspaces', { params: { query: { cursor, limit: PAGE } }, signal })),
  );

  const out: ExportFile['workspaces'] = [];
  for (const [w, workspace] of workspaces.entries()) {
    const place = { name: workspace.name, n: w + 1, total: workspaces.length };
    onProgress(s.progress.conversations(place));
    const conversations = await allPages((cursor) =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/conversations', {
          params: { path: { workspaceId: workspace.id }, query: { cursor, limit: PAGE } },
          signal,
        }),
      ),
    );

    const withMessages: ExportFile['workspaces'][number]['conversations'] = [];
    for (const [c, conversation] of conversations.entries()) {
      onProgress(s.progress.messages(place, c + 1, conversations.length));
      const messages = await allPages(async (cursor) => {
        const detail = await unwrap(
          api.GET('/api/v1/conversations/{conversationId}', {
            params: { path: { conversationId: conversation.id }, query: { cursor, limit: PAGE } },
            signal,
          }),
        );
        return detail.messages;
      });
      // The API pages newest first; a reader expects a conversation in the order it happened.
      messages.reverse();
      counts.messages += messages.length;
      withMessages.push({ ...conversation, messages });
    }
    counts.conversations += withMessages.length;

    onProgress(s.progress.highlights(place));
    const highlights = await highlightsOf(workspace.id, signal);
    counts.highlights += highlights?.length ?? 0;

    out.push({
      ...workspace,
      conversations: withMessages,
      ...(highlights ? { highlights } : {}),
    });
  }
  counts.workspaces = out.length;

  onProgress(s.progress.memories);
  const memories = (await unwrap(api.GET('/api/v1/memories', { signal }))).items;
  counts.memories = memories.length;

  return {
    file: {
      exportedAt: new Date().toISOString(),
      account: { name: me.name, email: me.email, createdAt: me.createdAt },
      workspaces: out,
      memories,
    },
    counts,
  };
}

async function allPages<T>(fetchPage: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/**
 * The workspace's highlights, or undefined where there are none to read: a server without the
 * route answers 404, and a workspace the account only visits may answer 403.
 * Requested with fetch because the route is newer than the generated API types; the reply has
 * the same envelope, so `unwrap` reads it.
 */
async function highlightsOf(workspaceId: string, signal: AbortSignal) {
  try {
    return await allPages((cursor) => {
      const query = new URLSearchParams({ limit: String(PAGE) });
      if (cursor) query.set('cursor', cursor);
      const url = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/highlights?${query}`;
      return unwrap<Page<Highlight>>(
        fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal,
        }).then(async (response) => {
          const body: unknown = await response.json().catch(() => undefined);
          return response.ok
            ? { data: body as { data: Page<Highlight> }, response }
            : { error: body, response };
        }),
      );
    });
  } catch (error) {
    if (isApiError(error, 404) || isApiError(error, 403)) return undefined;
    throw error;
  }
}
