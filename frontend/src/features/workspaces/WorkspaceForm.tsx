import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { isApiError } from '@/api/client';
import { useCreateWorkspace } from '@/api/queries/workspaces';
import type { CreateWorkspaceBody, Workspace } from '@/api/types';
import { Button, Field, Input, RadioGroup, Textarea } from '@/ui';
import { workspaceStrings as t } from './strings';

type Template = NonNullable<CreateWorkspaceBody['template']>;
const templates: Template[] = ['BLANK', 'STUDY', 'CODEBASE'];

/**
 * Name, description and starting template for a new workspace. Used on the first-workspace
 * page and in the "New workspace" dialog; `footer` lets the dialog add its cancel button.
 */
export function CreateWorkspaceForm({
  onCreated,
  footer,
}: {
  onCreated: (workspace: Workspace) => void;
  footer?: (submit: ReactNode) => ReactNode;
}) {
  const create = useCreateWorkspace();
  const kindId = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<Template>('BLANK');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name: name.trim(), description: description.trim() || undefined, template },
      { onSuccess: onCreated },
    );
  };

  const button = (
    <Button
      type="submit"
      variant="primary"
      className="max-sm:w-full"
      loading={create.isPending}
      disabled={!name.trim()}
    >
      {t.create.submit}
    </Button>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field label={t.fields.name} error={create.error ? errorText(create.error) : undefined}>
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
      <div>
        <p id={kindId} className="text-xs font-medium text-ink">
          {t.fields.kind}
        </p>
        <RadioGroup
          aria-labelledby={kindId}
          value={template}
          onValueChange={(value) => setTemplate(value as Template)}
          options={templates.map((value) => {
            const [label, hint] = t.templates[value];
            return { value, label, description: hint };
          })}
        />
      </div>
      {footer ? footer(button) : <div>{button}</div>}
    </form>
  );
}

export function errorText(error: unknown) {
  if (isApiError(error)) return error.message;
  return 'Something went wrong. Try again.';
}
