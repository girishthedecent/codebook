import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { keys } from '@/api/queries/keys';
import type { Conversation, ConversationDetail, Page } from '@/api/types';
import { messagesKey } from './useMessages';

/**
 * Writes a conversation's new title into every cache that shows it (the transcript's header and
 * the sidebar list), so it changes at once instead of after the next refetch.
 */
export function applyTitle(
  client: QueryClient,
  workspaceId: string,
  conversationId: string,
  title: string,
) {
  client.setQueryData<InfiniteData<ConversationDetail>>(
    messagesKey(conversationId),
    (old) =>
      old && { ...old, pages: old.pages.map((page, i) => (i === 0 ? { ...page, title } : page)) },
  );
  client.setQueryData<ConversationDetail>(keys.conversation(conversationId), (old) =>
    old ? { ...old, title } : old,
  );
  client.setQueriesData<InfiniteData<Page<Conversation>>>(
    { queryKey: keys.conversations(workspaceId) },
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((c) => (c.id === conversationId ? { ...c, title } : c)),
        })),
      },
  );
}

/** Refetches the lists that show a conversation's title. */
export function refreshTitles(client: QueryClient, workspaceId: string, conversationId: string) {
  void client.invalidateQueries({ queryKey: keys.conversation(conversationId) });
  void client.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
}
