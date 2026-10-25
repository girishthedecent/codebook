import { useEffect } from 'react';
import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { keys } from '@/api/queries/keys';
import type { ConversationDetail } from '@/api/types';

// Under the conversation's own key, so every invalidation of the conversation reaches it.
export const messagesKey = (conversationId: string) =>
  [...keys.conversation(conversationId), 'all'] as const;

/**
 * Every message of a conversation, oldest first. The API pages forward from the start, and a
 * transcript needs all of it, so the remaining pages load right after the first.
 */
export function useMessages(conversationId: string) {
  const query = useInfiniteQuery({
    queryKey: messagesKey(conversationId),
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/api/v1/conversations/{conversationId}', {
          params: { path: { conversationId }, query: { cursor: pageParam, limit: 100 } },
          signal,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.messages.nextCursor ?? undefined,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const first = query.data?.pages[0];
  const messages = query.data?.pages.flatMap((p) => p.messages.items) ?? [];
  return { query, conversation: first, messages, complete: !hasNextPage };
}

/** Seeds a just-created conversation so its page renders without a loading state. */
export function seedMessages(client: QueryClient, detail: ConversationDetail) {
  client.setQueryData(messagesKey(detail.id), {
    pages: [detail],
    pageParams: [undefined],
  });
}
