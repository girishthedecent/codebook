import { Button, Dialog } from '@/ui';
import { chat } from './strings';

export function DeleteConversationDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
  failed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
  failed?: boolean;
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
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            {chat.delete}
          </Button>
        </>
      }
    >
      {failed && (
        <p className="text-sm text-error" role="alert">
          {chat.deleteFailed}
        </p>
      )}
    </Dialog>
  );
}
