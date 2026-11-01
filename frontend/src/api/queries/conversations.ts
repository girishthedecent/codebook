import {
  infiniteQueryOptions,
  type InfiniteData,
  type QueryKey,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, unwrap } from '../client';
import type { Conversation, ConversationDetail, FeedbackBody } from '../types';
import { keys } from './keys';

/** When the conversation was pinned (null when it isn't), and its first question, cut short. */
export type ConversationExtras = { pinnedAt?: string | null; preview?: string | null };
export type ConversationSummary = Conversation & ConversationExtras;
export type ConversationDetailWithExtras = ConversationDetail & ConversationExtras;

type ConversationPage = { items: ConversationSummary[]; nextCursor: string | null };

export const conversationsQueryOptions = (workspaceId: string) =>
  infiniteQueryOptions({
    queryKey: keys.conversations(workspaceId),
    queryFn: ({ pageParam, signal }): Promise<ConversationPage> =>
      unwrap(
        api.GET('/api/v1/workspaces/{workspaceId}/conversations', {
          params: { path: { workspaceId }, query: { cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** One conversation with its latest page of messages (older ones through `cursor`). */
export const conversationQueryOptions = (conversationId: string, cursor?: string) =>
  queryOptions({
    queryKey: cursor
      ? [...keys.conversation(conversationId), cursor]
      : keys.conversation(conversationId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/conversations/{conversationId}', {
          params: { path: { conversationId }, query: { cursor, limit: 50 } },
          signal,
        }),
      ),
  });

export function useConversations(workspaceId: string) {
  return useInfiniteQuery(conversationsQueryOptions(workspaceId));
}

export function useConversation(conversationId: string) {
  return useQuery(conversationQueryOptions(conversationId));
}

export function useCreateConversation(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) =>
      unwrap(
        api.POST('/api/v1/workspaces/{workspaceId}/conversations', {
          params: { path: { workspaceId } },
          body: title ? { title } : {},
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.conversations(workspaceId) }),
  });
}

export function useRenameConversation(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, title }: { conversationId: string; title: string }) =>
      unwrap(
        api.PATCH('/api/v1/conversations/{conversationId}', {
          params: { path: { conversationId } },
          body: { title },
        }),
      ),
    onSuccess: (conversation: Conversation) => {
      client.setQueryData(keys.conversation(conversation.id), (old: object | undefined) =>
        old ? { ...old, title: conversation.title } : old,
      );
      void client.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
    },
  });
}

export function useDeleteConversation(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      unwrap(
        api.DELETE('/api/v1/conversations/{conversationId}', {
          params: { path: { conversationId } },
        }),
      ),
    onSuccess: (_data, conversationId) => {
      client.removeQueries({ queryKey: keys.conversation(conversationId) });
      void client.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
    },
  });
}

type PinContext = {
  list?: InfiniteData<ConversationPage>;
  details: [QueryKey, unknown][];
};

function withPinned(data: unknown, pinnedAt: string | null): unknown {
  if (!data || typeof data !== 'object') return data;
  // The transcript is an infinite query whose every page repeats the conversation's fields.
  if ('pages' in data && Array.isArray(data.pages)) {
    return { ...data, pages: data.pages.map((page: object) => ({ ...page, pinnedAt })) };
  }
  return { ...data, pinnedAt };
}

/**
 * Pins or unpins a conversation. The list and the open conversation change at once and are
 * put back if the server refuses; a pinned conversation sits above the dated groups.
 */
export function usePinConversation(workspaceId: string) {
  const client = useQueryClient();
  const listKey = keys.conversations(workspaceId);
  return useMutation<Conversation, Error, { conversationId: string; pinned: boolean }, PinContext>({
    mutationFn: ({ conversationId, pinned }) =>
      unwrap(
        api.PATCH('/api/v1/conversations/{conversationId}', {
          params: { path: { conversationId } },
          body: { pinned } as unknown as { title: string },
        }),
      ),
    onMutate: async ({ conversationId, pinned }) => {
      const detailKey = keys.conversation(conversationId);
      await Promise.all([
        client.cancelQueries({ queryKey: listKey }),
        client.cancelQueries({ queryKey: detailKey }),
      ]);
      const pinnedAt = pinned ? new Date().toISOString() : null;
      const list = client.getQueryData<InfiniteData<ConversationPage>>(listKey);
      const details = client.getQueriesData({ queryKey: detailKey });
      client.setQueryData<InfiniteData<ConversationPage>>(listKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((c) => (c.id === conversationId ? { ...c, pinnedAt } : c)),
              })),
            }
          : old,
      );
      client.setQueriesData({ queryKey: detailKey }, (old: unknown) => withPinned(old, pinnedAt));
      return { list, details };
    },
    onError: (_error, _vars, context) => {
      if (!context) return;
      client.setQueryData(listKey, context.list);
      for (const [key, data] of context.details) client.setQueryData(key, data);
    },
    onSettled: (_data, _error, { conversationId }) => {
      void client.invalidateQueries({ queryKey: listKey });
      void client.invalidateQueries({ queryKey: keys.conversation(conversationId) });
    },
  });
}

/** "Helpful" / "Not helpful" on an assistant message. */
export function useMessageFeedback(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, ...body }: { messageId: string } & FeedbackBody) =>
      unwrap(
        api.POST('/api/v1/messages/{messageId}/feedback', {
          params: { path: { messageId } },
          body,
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.conversation(conversationId) }),
  });
}

/** After a turn (streamed or aborted) the saved messages are the truth: refetch them. */
export function invalidateConversation(
  client: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  conversationId: string,
) {
  void client.invalidateQueries({ queryKey: keys.conversation(conversationId) });
  void client.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
  void client.invalidateQueries({ queryKey: keys.usage });
}
