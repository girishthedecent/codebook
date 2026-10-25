import { useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { keys } from '@/api/queries/keys';
import { useDeleteConversation, useRenameConversation } from '@/api/queries/conversations';
import { BackLink, Menu, MenuItem, MenuSeparator } from '@/ui';
import { useBreakpoint } from '@/lib/breakpoints';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { discardTurn } from './useTurn';
import { RenameInput } from './RenameInput';
import { chat } from './strings';

/** Title of the conversation, renamed in place, with a small menu. Sticks to the top. */
export function ConversationHeader({
  workspaceId,
  conversationId,
  title,
}: {
  workspaceId: string;
  conversationId: string;
  title?: string;
}) {
  const navigate = useNavigate();
  const phone = useBreakpoint() === 'phone';
  const client = useQueryClient();
  const rename = useRenameConversation(workspaceId);
  const remove = useDeleteConversation(workspaceId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

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

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper">
      <div className="mx-auto flex h-12 w-full max-w-[720px] items-center gap-2 px-4 md:px-6">
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
            className="h-8 flex-1 text-sm font-medium"
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {title ?? <span className="text-ink-3">{chat.untitled}</span>}
          </h1>
        )}
        <Menu
          align="end"
          trigger={
            <button
              ref={menuButton}
              type="button"
              aria-label={chat.options}
              className="flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink max-[719px]:size-11"
            >
              <DotsThree size={18} weight="bold" />
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
        onOpenChange={(open) => {
          setConfirming(open);
          if (open) remove.reset();
        }}
        onConfirm={confirmDelete}
        pending={remove.isPending}
        failed={remove.isError}
      />
      {rename.isError && (
        <p className="mx-auto max-w-[720px] px-4 pb-2 text-xs text-error md:px-6" role="alert">
          {chat.renameFailed}
        </p>
      )}
    </header>
  );
}
