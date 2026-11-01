import { useEffect, useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { keys } from '@/api/queries/keys';
import {
  useDeleteConversation,
  usePinConversation,
  useRenameConversation,
} from '@/api/queries/conversations';
import { BackLink, Button, Callout, Menu, MenuItem, MenuSeparator } from '@/ui';
import { useBreakpoint } from '@/lib/breakpoints';
import { cn } from '@/lib/cn';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { discardTurn } from './useTurn';
import { RenameInput } from './RenameInput';
import { chat } from './strings';

type Notice = { text: string; error?: boolean };

/**
 * The bar at the top of a conversation: its title, renamed in place, and a menu. It sticks to
 * the top; while the first question is still on screen it reads as the heading, so the bar
 * keeps the title out of sight until that question scrolls away.
 */
export function ConversationHeader({
  workspaceId,
  conversationId,
  title,
  pinned,
  titleShown,
  onExport,
}: {
  workspaceId: string;
  conversationId: string;
  title?: string;
  pinned: boolean;
  titleShown: boolean;
  /** Saves the conversation as a file; not given while there is nothing to save. */
  onExport?: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const phone = useBreakpoint() === 'phone';
  const client = useQueryClient();
  const rename = useRenameConversation(workspaceId);
  const remove = useDeleteConversation(workspaceId);
  const pin = usePinConversation(workspaceId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  // The title input unmounts when it finishes, which would drop focus to the page.
  const endEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => menuButton.current?.focus());
  };

  const save = (value: string) => {
    endEditing();
    rename.reset();
    if (!value || value === title) return;
    rename.mutate(
      { conversationId, title: value },
      {
        onSuccess: () => client.invalidateQueries({ queryKey: keys.conversation(conversationId) }),
      },
    );
  };

  const leave = () => {
    discardTurn(conversationId);
    setConfirming(false);
    void navigate({ to: '/w/$workspaceId', params: { workspaceId } });
  };

  // Already deleted somewhere else is the outcome the reader asked for.
  const confirmDelete = () =>
    remove.mutate(conversationId, {
      onSuccess: leave,
      onError: (e) => isApiError(e, 404) && leave(),
    });

  // The address of the conversation itself, without whatever the viewer has open.
  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    const write = navigator.clipboard?.writeText(url);
    if (!write) return setNotice({ text: chat.linkCopyFailed, error: true });
    write.then(
      () => setNotice({ text: chat.linkCopied }),
      () => setNotice({ text: chat.linkCopyFailed, error: true }),
    );
  };

  const exportFile = () => {
    onExport?.().catch(() => setNotice({ text: chat.exportFailed, error: true }));
  };

  const heading = editing || titleShown;

  return (
    <header
      className={cn(
        'sticky top-0 z-10 border-b bg-paper motion-safe:transition-colors motion-safe:duration-200',
        heading ? 'border-rule' : 'border-transparent',
      )}
    >
      <div className="mx-auto flex h-12 w-full max-w-narrow items-center gap-2 px-4 sm:px-6">
        {phone && (
          <BackLink to="/w/$workspaceId" params={{ workspaceId }} className="shrink-0">
            <span className="sr-only">{chat.back}</span>
          </BackLink>
        )}
        {editing ? (
          <RenameInput
            initial={title ?? ''}
            label={chat.rename}
            onDone={save}
            onCancel={endEditing}
            className="h-8 flex-1 font-serif font-semibold"
          />
        ) : (
          <h1
            className={cn(
              'min-w-0 flex-1 truncate font-serif text-base font-semibold text-ink motion-safe:transition-[opacity,translate] motion-safe:duration-200',
              heading ? 'opacity-100' : 'translate-y-1 opacity-0',
            )}
          >
            {title ?? <span className="text-ink-3">{chat.untitled}</span>}
          </h1>
        )}
        <span
          role="status"
          className={cn('shrink-0 text-xs', notice?.error ? 'text-error' : 'text-ink-3')}
        >
          {notice?.text}
        </span>
        <Menu
          align="end"
          trigger={
            <Button
              ref={menuButton}
              variant="ghost"
              aria-label={chat.options}
              className="w-9 shrink-0 px-0! max-sm:w-11"
            >
              <DotsThree size={18} weight="bold" />
            </Button>
          }
        >
          <MenuItem onSelect={() => setEditing(true)}>{chat.rename}</MenuItem>
          <MenuItem onSelect={() => pin.mutate({ conversationId, pinned: !pinned })}>
            {pinned ? chat.unpin : chat.pin}
          </MenuItem>
          <MenuItem onSelect={copyLink}>{chat.copyLink}</MenuItem>
          <MenuItem onSelect={exportFile} disabled={!onExport}>
            {chat.exportMarkdown}
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
        <div className="mx-auto max-w-narrow px-4 pb-2 sm:px-6">
          <Callout tone="error">{rename.isError ? chat.renameFailed : chat.pinFailed}</Callout>
        </div>
      )}
    </header>
  );
}
