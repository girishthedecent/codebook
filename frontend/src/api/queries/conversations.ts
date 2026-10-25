import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, unwrap } from '../client';
import type { Conversation, FeedbackBody } from '../types';
import { keys } from './keys';

export const conversationsQueryOptions = (workspaceId: string) =>
  infiniteQueryOptions({
    queryKey: keys.conversations(workspaceId),
    queryFn: ({ pageParam, signal }) =>
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
