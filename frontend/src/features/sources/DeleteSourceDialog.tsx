import { useEffect } from 'react';
import { isApiError } from '@/api/client';
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
  const { reset } = remove;
  // The mutation outlives the dialog, so a failure from last time would show again.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  const finish = () => {
    onOpenChange(false);
    onDeleted?.();
  };
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
            variant="danger"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(source.id, {
                onSuccess: finish,
                // Already gone (another tab, or a retry after a dropped reply) is the goal met.
                onError: (error) => isApiError(error, 404) && finish(),
              })
            }
          >
            {strings.delete}
          </Button>
        </>
      }
    >
      <p className="text-ink-2">{strings.deleteBody}</p>
      {remove.error && !isApiError(remove.error, 404) && (
        <p role="alert" className="mt-3 break-words text-error">
          {remove.error.message}
        </p>
      )}
    </Dialog>
  );
}
