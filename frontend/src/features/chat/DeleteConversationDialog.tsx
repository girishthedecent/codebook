import { Button, Dialog } from '@/ui';
import { chat } from './strings';

export function DeleteConversationDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={chat.deleteTitle}
      description={chat.deleteBody}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {chat.cancel}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={onConfirm}
            className="bg-error! hover:bg-error! hover:opacity-90"
          >
            {chat.delete}
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
}
