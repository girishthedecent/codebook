import { useEffect, useRef, useState } from 'react';
import { DotsThree, PushPin } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { flatItems } from '@/api/queries/keys';
import {
  useConversations,
  useDeleteConversation,
  usePinConversation,
  useRenameConversation,
} from '@/api/queries/conversations';
import type { Conversation } from '@/api/types';
import { Button, Input, Menu, MenuItem, MenuSeparator, Skeleton, TextButton, TextLink } from '@/ui';
import { useBreakpoint } from '@/lib/breakpoints';
import { cn } from '@/lib/cn';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { RenameInput } from './RenameInput';
import { discardTurn } from './useTurn';
import { chat } from './strings';

const DAY = 24 * 60 * 60 * 1000;
// A short list is quicker to scan than to filter.
const FILTER_FROM = 9;

function groupOf(updatedAt: string, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(updatedAt).getTime();
  if (t >= startOfToday) return chat.today;
  if (t >= startOfToday - 6 * DAY) return chat.thisWeek;
  return chat.older;
}

/** Pinned conversations first, in the order the server gives them, then the rest by date. */
function grouped(items: Conversation[]) {
  const now = new Date();
  const pinned = items.filter((c) => c.pinnedAt);
  const groups: { label: string; items: Conversation[] }[] = pinned.length
    ? [{ label: chat.pinned, items: pinned }]
    : [];
  const dated: typeof groups = [];
  for (const c of items) {
    if (c.pinnedAt) continue;
    const label = groupOf(c.updatedAt, now);
    const last = dated.at(-1);
    if (last?.label === label) last.items.push(c);
    else dated.push({ label, items: [c] });
  }
  return [...groups, ...dated];
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** What a row is called. An untitled conversation goes by how it began, when that is known. */
function rowTitle(c: Conversation) {
  return c.title === chat.untitled && c.preview ? c.preview : c.title;
}

/** The preview under the title, unless it only repeats it: titles are often its first words. */
function rowPreview(c: Conversation, title: string) {
  if (!c.preview) return undefined;
  const a = squash(title).replace(/[….]+$/, '');
  const b = squash(c.preview);
  return b.startsWith(a) || a.startsWith(b) ? undefined : c.preview;
}

function matches(c: Conversation, needle: string) {
  return squash(c.title).includes(needle) || squash(c.preview ?? '').includes(needle);
}

/**
 * The sidebar's conversation list for a workspace: pinned ones first, then the rest grouped by
 * when they were last used. A filter appears once the list is long. Renders nothing when the
 * sidebar is collapsed to icons.
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
  const phone = useBreakpoint() === 'phone';
  const [filter, setFilter] = useState('');
  if (collapsed) return null;

  const filterable = items.length >= FILTER_FROM;
  const needle = filterable ? squash(filter) : '';
  const shown = needle ? items.filter((c) => matches(c, needle)) : items;
  const filterId = `conversation-filter-${workspaceId}`;

  return (
    <section aria-labelledby="conversations-heading" className="px-2">
      <div className="flex h-8 items-center justify-between px-2">
        <h2 id="conversations-heading" className="text-xs font-medium text-ink-3">
          {chat.conversations}
        </h2>
        <TextLink
          to="/w/$workspaceId"
          params={{ workspaceId }}
          // Already on the home page the link goes nowhere, so it puts the cursor in the box.
          onClick={() => {
            if (!phone)
              setTimeout(() => document.getElementById(`composer-new:${workspaceId}`)?.focus(), 0);
          }}
          className="text-xs no-underline hover:underline [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center"
        >
          {chat.newConversation}
        </TextLink>
      </div>

      {filterable && (
        <div className="px-1 pt-1 pb-1.5">
          <label htmlFor={filterId} className="sr-only">
            {chat.filterLabel}
          </label>
          <Input
            id={filterId}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter) {
                e.preventDefault();
                setFilter('');
              }
            }}
            placeholder={chat.filterPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}

      {query.isPending && (
        <div className="space-y-2 px-2 py-2" role="status">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      )}

      {query.isError && items.length === 0 && (
        <div className="px-2 py-1 text-xs text-ink-3">
          <p>{chat.listFailed}</p>
          <TextButton
            onClick={() => void query.refetch()}
            className="mt-1 [@media(pointer:coarse)]:min-h-11"
          >
            {chat.retry}
          </TextButton>
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <p className="px-2 py-1 text-xs text-ink-3">{chat.noConversations}</p>
      )}

      {needle && shown.length === 0 && (
        <p className="px-2 py-1 text-xs text-ink-3" role="status">
          {chat.noMatches(filter.trim())}
        </p>
      )}

      {grouped(shown).map((g) => (
        <div key={g.label} className="mt-2">
          <h3 className="px-2 py-1 text-xs text-ink-3">{g.label}</h3>
          <ul>
            {g.items.map((c) => (
              <ConversationRow key={c.id} workspaceId={workspaceId} conversation={c} />
            ))}
          </ul>
        </div>
      ))}

      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void query.fetchNextPage()}
          loading={query.isFetchingNextPage}
          className="mt-1"
        >
          {chat.showMore}
        </Button>
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
  const pin = usePinConversation(workspaceId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const active = params.conversationId === conversation.id;
  const pinned = Boolean(conversation.pinnedAt);
  const title = rowTitle(conversation);
  const preview = rowPreview(conversation, title);
  const link = useRef<HTMLAnchorElement>(null);
  const wasEditing = useRef(false);

  // The input replaces the row, so when it closes focus goes back to the row's link.
  useEffect(() => {
    if (wasEditing.current && !editing) link.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const save = (value: string) => {
    setEditing(false);
    rename.reset();
    if (value && value !== conversation.title) {
      rename.mutate({ conversationId: conversation.id, title: value });
    }
  };

  const gone = () => {
    discardTurn(conversation.id);
    setConfirming(false);
    if (active) void navigate({ to: '/w/$workspaceId', params: { workspaceId } });
  };

  const confirmDelete = () =>
    remove.mutate(conversation.id, {
      onSuccess: gone,
      onError: (e) => isApiError(e, 404) && gone(),
    });

  if (editing) {
    return (
      <li className="px-1 py-0.5">
        <RenameInput
          initial={conversation.title}
          label={chat.rename}
          onDone={save}
          onCancel={() => setEditing(false)}
          className="h-7 text-sm [@media(pointer:coarse)]:h-11"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        ref={link}
        to="/w/$workspaceId/c/$conversationId"
        params={{ workspaceId, conversationId: conversation.id }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative block rounded-sm py-1.5 pr-8 pl-2 text-sm text-ink-2 hover:bg-paper-3 hover:text-ink [@media(pointer:coarse)]:py-3 [@media(pointer:coarse)]:pr-12',
          active &&
            'bg-paper-3 text-ink before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent',
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate', active && 'font-medium')}>{title}</span>
          {pinned && (
            <PushPin size={12} weight="fill" aria-hidden className="shrink-0 text-ink-3" />
          )}
        </span>
        {preview && <span className="block truncate text-xs text-ink-3">{preview}</span>}
      </Link>
      <div
        className={cn(
          'absolute top-0.5 right-1 flex h-7 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:top-0 [@media(pointer:coarse)]:h-11',
          active && 'opacity-100',
        )}
      >
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              aria-label={`${chat.options}: ${title}`}
              className="flex size-6 items-center justify-center rounded-xs text-ink-3 [@media(pointer:coarse)]:size-11 hover:bg-paper-2 hover:text-ink"
            >
              <DotsThree size={16} weight="bold" />
            </button>
          }
        >
          <MenuItem onSelect={() => setEditing(true)}>{chat.rename}</MenuItem>
          <MenuItem
            onSelect={() => pin.mutate({ conversationId: conversation.id, pinned: !pinned })}
          >
            {pinned ? chat.unpin : chat.pin}
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => setConfirming(true)}>
            {chat.delete}
          </MenuItem>
        </Menu>
      </div>
      <DeleteConversationDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (open) remove.reset();
        }}
        onConfirm={confirmDelete}
        pending={remove.isPending}
        failed={remove.isError}
      />
      {(rename.isError || pin.isError) && (
        <p className="px-2 pb-1 text-xs text-error" role="alert">
          {rename.isError ? chat.renameFailed : chat.pinFailed}
        </p>
      )}
    </li>
  );
}
