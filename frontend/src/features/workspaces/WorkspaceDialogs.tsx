import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { useDeleteWorkspace, useUpdateWorkspace } from '@/api/queries/workspaces';
import type { UpdateWorkspaceBody, Workspace } from '@/api/types';
import { Button, Checkbox, Dialog, DialogClose, Field, Input, Select, Textarea } from '@/ui';
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

type Settings = NonNullable<UpdateWorkspaceBody['settings']>;
type SearchMode = NonNullable<Settings['defaultSearchMode']>;
type Tool = NonNullable<Settings['preferredTools']>[number];

const SEARCH_MODES: SearchMode[] = ['hybrid', 'vector', 'keyword'];
const TOOLS = Object.keys(t.edit.toolLabels) as Tool[];

/** Edits a workspace's name, description and how it searches. */
export function RenameWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: DialogState & { workspace: Workspace }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.edit.title} size="lg">
      {open && <EditForm workspace={workspace} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function EditForm({ workspace, onDone }: { workspace: Workspace; onDone: () => void }) {
  const update = useUpdateWorkspace(workspace.id);
  const initialMode = workspace.settings.defaultSearchMode ?? 'hybrid';
  const initialTools = workspace.settings.preferredTools ?? [];
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [tools, setTools] = useState<Tool[]>(initialTools);

  const modeChanged = mode !== initialMode;
  const toolsChanged =
    tools.length !== initialTools.length || tools.some((tool) => !initialTools.includes(tool));
  const unchanged =
    name.trim() === workspace.name &&
    (description.trim() || null) === (workspace.description ?? null) &&
    !modeChanged &&
    !toolsChanged;

  const toggleTool = (tool: Tool, on: boolean) =>
    setTools((cur) => (on ? [...cur, tool] : cur.filter((x) => x !== tool)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    // Only what changed is sent; the server merges it into the settings already stored.
    const settings: Settings = {};
    if (modeChanged) settings.defaultSearchMode = mode;
    if (toolsChanged) settings.preferredTools = tools;
    update.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        settings: modeChanged || toolsChanged ? settings : undefined,
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
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
      </div>

      <section aria-labelledby="search-settings" className="flex flex-col gap-5">
        <h3 id="search-settings" className="heading-minor text-ink">
          {t.edit.searchTitle}
        </h3>
        <Field label={t.edit.searchMode} hint={t.edit.searchHint}>
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as SearchMode)}
            className="sm:w-fit"
          >
            {SEARCH_MODES.map((value) => (
              <option key={value} value={value}>
                {t.edit.searchModes[value]}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <p id="preferred-tools" className="text-xs font-medium text-ink">
            {t.edit.tools}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">{t.edit.toolsHint}</p>
          <div
            role="group"
            aria-labelledby="preferred-tools"
            className="mt-1 grid gap-x-6 sm:grid-cols-2"
          >
            {TOOLS.map((tool) => {
              const [label, hint] = t.edit.toolLabels[tool];
              return (
                <Checkbox
                  key={tool}
                  checked={tools.includes(tool)}
                  onCheckedChange={(on) => toggleTool(tool, on)}
                  label={label}
                  description={hint}
                />
              );
            })}
          </div>
        </div>
      </section>

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
          {t.edit.submit}
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
