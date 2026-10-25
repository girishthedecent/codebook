import { useEffect, useRef, useState } from 'react';
import {
  useClearMemories,
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useRestoreMemory,
  useUpdateMemory,
} from '@/api/queries/memories';
import type { Memory } from '@/api/types';
import {
  Button,
  Dialog,
  Field,
  Input,
  ProgressRule,
  Switch,
  Textarea,
  controlClass,
  toast,
} from '@/ui';
import { cn } from '@/lib/cn';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { en } from '@/i18n/en';
import { InlineError } from '@/features/account/InlineError';
import { PageHeader, SectionHeading } from '@/features/account/PageHeader';
import { formatWhen } from '@/features/account/format';
import { strings } from '@/features/account/strings';

const s = strings.memory;
const KINDS = ['PROFILE', 'FACT'] as const;
type Kind = (typeof KINDS)[number];
// Mirrors the backend's memory.maxContentChars.
const MAX_CHARS = 300;

export function MemoryPage() {
  const [showDeleted, setShowDeleted] = useState(false);
  const [clearing, setClearing] = useState(false);
  const memories = useMemories(showDeleted ? { includeDeleted: '1' } : {});
  const items = memories.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={s.title}
        intro={s.intro}
        actions={
          items.some((m) => !m.deletedAt) && (
            <Button variant="ghost" size="sm" onClick={() => setClearing(true)}>
              {s.clearAll}
            </Button>
          )
        }
      />
      <div className="max-w-[640px] space-y-10">
        <AddMemory />
        <Switch checked={showDeleted} onCheckedChange={setShowDeleted} label={s.showDeleted} />
        {memories.isPending ? (
          <ProgressRule label="Loading memories" />
        ) : memories.isError ? (
          <InlineError error={memories.error} retry={() => void memories.refetch()} />
        ) : (
          KINDS.map((kind) => (
            <MemoryGroup key={kind} kind={kind} items={items.filter((m) => m.kind === kind)} />
          ))
        )}
      </div>
      <ClearAllDialog open={clearing} onOpenChange={setClearing} />
    </>
  );
}

function MemoryGroup({ kind, items }: { kind: Kind; items: Memory[] }) {
  return (
    <section>
      <SectionHeading hint={s.kinds[kind].hint}>{s.kinds[kind].label}</SectionHeading>
      {items.length === 0 ? (
        <p className="py-3 text-sm text-ink-3">{s.empty}</p>
      ) : (
        <ul>
          {items.map((m) => (
            <MemoryRow key={m.id} memory={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemoryRow({ memory }: { memory: Memory }) {
  const [editing, setEditing] = useState(false);
  const remove = useDeleteMemory();
  const restore = useRestoreMemory();
  const editButton = useRef<HTMLButtonElement>(null);
  const deleted = Boolean(memory.deletedAt);

  const onRemove = () =>
    remove.mutate(memory.id, {
      onSuccess: () =>
        toast({
          title: s.removed,
          action: {
            label: s.undo,
            onClick: () =>
              restore.mutate(memory.id, {
                onError: (e) => toast({ title: e.message, kind: 'error' }),
              }),
          },
        }),
      onError: (e) => toast({ title: e.message, kind: 'error' }),
    });

  const finishEdit = () => {
    setEditing(false);
    // The Edit button is unmounted while the form is open; put focus back on it afterwards.
    requestAnimationFrame(() => editButton.current?.focus());
  };

  if (editing) return <EditRow memory={memory} onDone={finishEdit} />;

  return (
    <li className="flex gap-x-4 gap-y-1 border-b border-rule py-3 last:border-b-0 max-[719px]:flex-col min-[720px]:items-start">
      <div className={cn('min-w-0 flex-1', deleted && 'text-ink-3')}>
        <p className={cn('font-serif text-base', deleted && 'line-through')}>{memory.content}</p>
        <p className="mt-1 font-mono text-xs text-ink-3">
          {deleted ? s.deleted : s.added(formatWhen(memory.createdAt))}
          {!deleted && memory.lastUsedAt && ` · ${s.used(formatWhen(memory.lastUsedAt))}`}
        </p>
      </div>
      <div className="flex shrink-0 gap-1 max-[719px]:-ml-2.5">
        {deleted ? (
          <Button
            variant="ghost"
            size="sm"
            loading={restore.isPending}
            onClick={() =>
              restore.mutate(memory.id, {
                onError: (e) => toast({ title: e.message, kind: 'error' }),
              })
            }
          >
            {s.restore}
          </Button>
        ) : (
          <>
            <Button ref={editButton} variant="ghost" size="sm" onClick={() => setEditing(true)}>
              {s.edit}
            </Button>
            <Button variant="ghost" size="sm" loading={remove.isPending} onClick={onRemove}>
              {s.remove}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function EditRow({ memory, onDone }: { memory: Memory; onDone: () => void }) {
  const [content, setContent] = useState(memory.content);
  const update = useUpdateMemory();
  const input = useRef<HTMLTextAreaElement>(null);
  const trimmed = content.trim();
  const unchanged = trimmed === memory.content;

  useUnsavedChanges(!unchanged && !update.isSuccess);

  // The user just pressed Edit, so the text is what they want to type into.
  useEffect(() => input.current?.focus(), []);

  const save = () => {
    if (unchanged) return onDone();
    update.mutate({ memoryId: memory.id, content: trimmed }, { onSuccess: onDone });
  };

  return (
    <li className="border-b border-rule py-3 last:border-b-0">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label={<span className="sr-only">{s.edit}</span>}
          error={update.error?.message}
          hint={`${trimmed.length} / ${MAX_CHARS}`}
        >
          <Textarea
            ref={input}
            rows={2}
            value={content}
            maxLength={MAX_CHARS}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onDone();
            }}
          />
        </Field>
        <div className="mt-2 flex gap-2">
          <Button type="submit" size="sm" loading={update.isPending} disabled={!trimmed}>
            {en.common.save}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {en.common.cancel}
          </Button>
        </div>
      </form>
    </li>
  );
}

function AddMemory() {
  const [content, setContent] = useState('');
  const [kind, setKind] = useState<Kind>('FACT');
  const create = useCreateMemory();
  const trimmed = content.trim();
  useUnsavedChanges(trimmed.length > 0);

  return (
    <section>
      <SectionHeading>{s.addTitle}</SectionHeading>
      <form
        className="mt-3 grid gap-3 min-[720px]:grid-cols-[1fr_10rem] min-[720px]:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          create.mutate({ kind, content: trimmed }, { onSuccess: () => setContent('') });
        }}
      >
        <Field label={s.addLabel} hint={s.addHint(MAX_CHARS)} error={create.error?.message}>
          <Textarea
            rows={2}
            value={content}
            maxLength={MAX_CHARS}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-3">
          <Field label={s.kindLabel}>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              className={cn(controlClass, 'h-9')}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {s.kinds[k].label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" loading={create.isPending} disabled={!trimmed}>
            {s.add}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ClearAllDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = useState('');
  const clear = useClearMemories();
  const close = (next: boolean) => {
    if (!next) {
      setTyped('');
      clear.reset();
    }
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={s.clearTitle}
      description={s.clearBody}
      size="sm"
      actions={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {en.common.cancel}
          </Button>
          <Button
            variant="danger"
            loading={clear.isPending}
            disabled={typed.trim().toLowerCase() !== s.clearWord}
            onClick={() =>
              clear.mutate(undefined, {
                onSuccess: () => {
                  toast({ title: s.cleared });
                  close(false);
                },
              })
            }
          >
            {s.clearAll}
          </Button>
        </>
      }
    >
      <Field label={s.clearConfirm} error={clear.error?.message}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </Field>
    </Dialog>
  );
}
