import { useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '@/api/queries/keys';
import { useDeleteConversation, useRenameConversation } from '@/api/queries/conversations';
import { Menu, MenuItem, MenuSeparator } from '@/ui';
import { DeleteConversationDialog } from './DeleteConversationDialog';
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
  const client = useQueryClient();
  const rename = useRenameConversation(workspaceId);
  const remove = useDeleteConversation(workspaceId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const save = (value: string) => {
    setEditing(false);
    if (!value || value === title) return;
    rename.mutate(
      { conversationId, title: value },
      {
        onSuccess: () => client.invalidateQueries({ queryKey: keys.conversation(conversationId) }),
      },
    );
  };

  const confirmDelete = () =>
    remove.mutate(conversationId, {
      onSuccess: () => {
        setConfirming(false);
        void navigate({ to: '/w/$workspaceId', params: { workspaceId } });
      },
    });

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper">
      <div className="mx-auto flex h-12 w-full max-w-[720px] items-center gap-2 px-4 md:px-6">
        {editing ? (
          <RenameInput
            initial={title ?? ''}
            label={chat.rename}
            onDone={save}
            onCancel={() => setEditing(false)}
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
        onOpenChange={setConfirming}
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </header>
  );
}
