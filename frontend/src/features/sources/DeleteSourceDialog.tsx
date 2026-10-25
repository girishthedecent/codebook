import { useDeleteSource } from '@/api/queries/sources';
import type { Source } from '@/api/types';
import { Button, Dialog } from '@/ui';
import { strings } from './strings';

export function DeleteSourceDialog({
  source,
  workspaceId,
  open,
  onOpenChange,
  onDeleted,
}: {
  source: Source;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const remove = useDeleteSource(workspaceId);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={strings.deleteTitle}
      description={source.title}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            className="border-error/40! text-error! hover:bg-error-wash!"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(source.id, {
                onSuccess: () => {
                  onOpenChange(false);
                  onDeleted?.();
                },
              })
            }
          >
            {strings.delete}
          </Button>
        </>
      }
    >
      <p className="text-ink-2">{strings.deleteBody}</p>
      {remove.error && <p className="mt-3 text-error">{remove.error.message}</p>}
    </Dialog>
  );
}
