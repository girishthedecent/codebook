import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { useDeleteWorkspace, useUpdateWorkspace } from '@/api/queries/workspaces';
import type { Workspace } from '@/api/types';
import { Button, Dialog, DialogClose, Field, Input, Textarea } from '@/ui';
import { CreateWorkspaceForm, errorText } from './WorkspaceForm';
import { forgetWorkspace } from './lastWorkspace';
import { workspaceStrings as t } from './strings';

type DialogState = { open: boolean; onOpenChange: (open: boolean) => void };

export function NewWorkspaceDialog({ open, onOpenChange }: DialogState) {
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.create.title}>
      {/* Remounted on every open so the form starts empty. */}
      {open && (
        <CreateWorkspaceForm
          onCreated={(ws) => {
            onOpenChange(false);
            void navigate({ to: '/w/$workspaceId', params: { workspaceId: ws.id } });
          }}
          footer={(submit) => (
            <div className="flex justify-end gap-2 border-t border-rule pt-3">
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              {submit}
            </div>
          )}
        />
      )}
    </Dialog>
  );
}

export function RenameWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: DialogState & { workspace: Workspace }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.rename.title}>
      {open && <RenameForm workspace={workspace} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function RenameForm({ workspace, onDone }: { workspace: Workspace; onDone: () => void }) {
  const update = useUpdateWorkspace(workspace.id);
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');

  const unchanged =
    name.trim() === workspace.name &&
    (description.trim() || null) === (workspace.description ?? null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    update.mutate(
      { name: name.trim(), description: description.trim() || null },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field label={t.fields.name} error={update.error ? errorText(update.error) : undefined}>
        <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t.fields.description} note={t.fields.optional}>
        <Textarea
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 border-t border-rule pt-3">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          loading={update.isPending}
          disabled={!name.trim() || unchanged}
        >
          {t.rename.submit}
        </Button>
      </div>
    </form>
  );
}

export function DeleteWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: DialogState & { workspace: Workspace }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.remove.title}
      description={t.remove.body}
      size="sm"
    >
      {open && <DeleteForm workspace={workspace} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function DeleteForm({ workspace, onDone }: { workspace: Workspace; onDone: () => void }) {
  const navigate = useNavigate();
  const remove = useDeleteWorkspace();
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === workspace.name;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    const leave = () => {
      forgetWorkspace(workspace.id);
      onDone();
      void navigate({ to: '/w', replace: true });
    };
    remove.mutate(workspace.id, {
      onSuccess: leave,
      // Already gone (another tab, or a retry after a dropped reply): same outcome.
      onError: (error) => isApiError(error, 404) && leave(),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field
        label={t.remove.confirm(workspace.name)}
        error={remove.error ? errorText(remove.error) : undefined}
      >
        <Input
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 border-t border-rule pt-3">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="danger" loading={remove.isPending} disabled={!matches}>
          {t.remove.submit}
        </Button>
      </div>
    </form>
  );
}
