import { useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { flatItems } from '@/api/queries/keys';
import {
  useConversations,
  useDeleteConversation,
  useRenameConversation,
} from '@/api/queries/conversations';
import type { Conversation } from '@/api/types';
import { Menu, MenuItem, MenuSeparator } from '@/ui';
import { cn } from '@/lib/cn';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { RenameInput } from './RenameInput';
import { chat } from './strings';

const DAY = 24 * 60 * 60 * 1000;

function groupOf(updatedAt: string, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(updatedAt).getTime();
  if (t >= startOfToday) return chat.today;
  if (t >= startOfToday - 6 * DAY) return chat.thisWeek;
  return chat.older;
}

function grouped(items: Conversation[]) {
  const now = new Date();
  const groups: { label: string; items: Conversation[] }[] = [];
  for (const c of items) {
    const label = groupOf(c.updatedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(c);
    else groups.push({ label, items: [c] });
  }
  return groups;
}

/**
 * The sidebar's conversation list for a workspace, newest first, grouped by when it was last
 * used. Renders nothing when the sidebar is collapsed to icons.
 */
export function ConversationsSection({
  workspaceId,
  collapsed,
}: {
  workspaceId: string;
  collapsed: boolean;
}) {
  const query = useConversations(workspaceId);
  const items = flatItems(query.data);
  if (collapsed) return null;

  return (
    <section aria-labelledby="conversations-heading" className="px-2">
      <div className="flex h-8 items-center justify-between px-2">
        <h2 id="conversations-heading" className="text-xs font-medium text-ink-3">
          {chat.conversations}
        </h2>
        <Link
          to="/w/$workspaceId"
          params={{ workspaceId }}
          className="text-xs text-accent hover:underline hover:underline-offset-2"
        >
          {chat.newConversation}
        </Link>
      </div>

      {query.isSuccess && items.length === 0 && (
        <p className="px-2 py-1 text-xs text-ink-3">{chat.noConversations}</p>
      )}

      {grouped(items).map((g) => (
        <div key={g.label} className="mt-2">
          <h3 className="px-2 py-1 font-mono text-[11px] tracking-wide text-ink-3">{g.label}</h3>
          <ul>
            {g.items.map((c) => (
              <ConversationRow key={c.id} workspaceId={workspaceId} conversation={c} />
            ))}
          </ul>
        </div>
      ))}

      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="mt-1 px-2 py-1 text-xs text-ink-3 hover:text-ink disabled:opacity-50"
        >
          {chat.showMore}
        </button>
      )}
    </section>
  );
}

function ConversationRow({
  workspaceId,
  conversation,
}: {
  workspaceId: string;
  conversation: Conversation;
}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const rename = useRenameConversation(workspaceId);
  const remove = useDeleteConversation(workspaceId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const active = params.conversationId === conversation.id;

  const save = (title: string) => {
    setEditing(false);
    if (title && title !== conversation.title) {
      rename.mutate({ conversationId: conversation.id, title });
    }
  };

  const confirmDelete = () =>
    remove.mutate(conversation.id, {
      onSuccess: () => {
        setConfirming(false);
        if (active) void navigate({ to: '/w/$workspaceId', params: { workspaceId } });
      },
    });

  if (editing) {
    return (
      <li className="px-1 py-0.5">
        <RenameInput
          initial={conversation.title}
          label={chat.rename}
          onDone={save}
          onCancel={() => setEditing(false)}
          className="h-7 text-sm"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        to="/w/$workspaceId/c/$conversationId"
        params={{ workspaceId, conversationId: conversation.id }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block truncate rounded-sm py-1.5 pr-8 pl-2 text-sm text-ink-2 hover:bg-paper-3 hover:text-ink',
          active && 'bg-paper-3 font-medium text-ink',
        )}
      >
        {conversation.title}
      </Link>
      <div
        className={cn(
          'absolute inset-y-0 right-1 flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          active && 'opacity-100',
        )}
      >
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              aria-label={`${chat.options}: ${conversation.title}`}
              className="flex size-6 items-center justify-center rounded-xs text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              <DotsThree size={16} weight="bold" />
            </button>
          }
        >
          <MenuItem onSelect={() => setEditing(true)}>{chat.rename}</MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => setConfirming(true)}>
            {chat.delete}
          </MenuItem>
        </Menu>
      </div>
      <DeleteConversationDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </li>
  );
}
