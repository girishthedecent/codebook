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
  Callout,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionHeading,
  Select,
  Switch,
  Textarea,
  toast,
} from '@/ui';
import { cn } from '@/lib/cn';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { en } from '@/i18n/en';
import { ListLoading } from '@/features/account/ListLoading';
import { formatWhen } from '@/features/account/format';
import { strings } from '@/features/account/strings';

const s = strings.memory;
const KINDS = ['PROFILE', 'FACT'] as const;
type Kind = (typeof KINDS)[number];
// Mirror the backend's memory.maxContentChars and memory.profileCap.
const MAX_CHARS = 300;
const PROFILE_CAP = 15;
const DEFAULT_IMPORTANCE = 3;
const LEVELS = [1, 2, 3, 4, 5] as const;

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
      <div className="flex max-w-narrow flex-col gap-10">
        <AddMemory />
        <Switch checked={showDeleted} onCheckedChange={setShowDeleted} label={s.showDeleted} />
        {memories.isPending ? (
          <ListLoading label="Loading memories" />
        ) : memories.isError ? (
          <Callout error={memories.error} onRetry={() => void memories.refetch()} />
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
  const live = items.filter((m) => !m.deletedAt).length;
  const hint =
    kind === 'PROFILE'
      ? `${s.kinds[kind].hint} ${s.profileCount(live, PROFILE_CAP)}`
      : s.kinds[kind].hint;
  return (
    <section aria-labelledby={`memory-${kind}`}>
      <SectionHeading id={`memory-${kind}`} hint={hint}>
        {s.kinds[kind].label}
      </SectionHeading>
      {items.length === 0 ? (
        <EmptyState className="py-4">{s.emptyKind[kind]}</EmptyState>
      ) : (
        <ul className="divide-y divide-rule">
          {items.map((m) => (
            <MemoryRow key={m.id} memory={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Five dots, as many filled as the memory's importance. */
function Importance({ level }: { level: number }) {
  const label = s.importance[level - 1] ?? s.importance[DEFAULT_IMPORTANCE - 1]!;
  return (
    <span role="img" aria-label={s.importanceOf(level, label)} className="inline-flex gap-0.5">
      {LEVELS.map((n) => (
        <span
          key={n}
          aria-hidden
          className={cn('size-1.5 rounded-full border border-ink-3', n <= level && 'bg-ink-3')}
        />
      ))}
    </span>
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
    <li className="flex gap-x-4 gap-y-1 py-3 max-sm:flex-col sm:items-start">
      <div className={cn('min-w-0 flex-1', deleted && 'text-ink-3')}>
        <p className={cn('font-serif text-base', deleted && 'line-through')}>{memory.content}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3">
          <Importance level={memory.importance} />
          <span>
            {deleted ? s.deleted : s.added(formatWhen(memory.createdAt))}
            {!deleted && memory.lastUsedAt && `, ${s.used(formatWhen(memory.lastUsedAt))}`}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 gap-1 max-sm:-ml-2.5">
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

function ImportanceSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={s.importanceLabel}>
      <Select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {LEVELS.map((n) => (
          <option key={n} value={n}>
            {n} · {s.importance[n - 1]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function EditRow({ memory, onDone }: { memory: Memory; onDone: () => void }) {
  const [content, setContent] = useState(memory.content);
  const [importance, setImportance] = useState(memory.importance);
  const update = useUpdateMemory();
  const input = useRef<HTMLTextAreaElement>(null);
  const trimmed = content.trim();
  const unchanged = trimmed === memory.content && importance === memory.importance;

  useUnsavedChanges(!unchanged && !update.isSuccess);

  // The user just pressed Edit, so the text is what they want to type into.
  useEffect(() => input.current?.focus(), []);

  const save = () => {
    if (unchanged) return onDone();
    update.mutate(
      {
        memoryId: memory.id,
        content: trimmed === memory.content ? undefined : trimmed,
        importance: importance === memory.importance ? undefined : importance,
      },
      { onSuccess: onDone },
    );
  };

  return (
    <li className="py-3">
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
        <div className="mt-3 sm:w-48">
          <ImportanceSelect value={importance} onChange={setImportance} />
        </div>
        <div className="mt-3 flex gap-2">
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
  const [importance, setImportance] = useState(DEFAULT_IMPORTANCE);
  const create = useCreateMemory();
  const trimmed = content.trim();
  useUnsavedChanges(trimmed.length > 0);

  return (
    <section aria-labelledby="memory-add">
      <SectionHeading id="memory-add">{s.addTitle}</SectionHeading>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_11rem]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          create.mutate(
            { kind, content: trimmed, importance },
            { onSuccess: () => setContent('') },
          );
        }}
      >
        <Field label={s.addLabel} hint={s.addHint(MAX_CHARS)} error={create.error?.message}>
          <Textarea
            rows={4}
            value={content}
            maxLength={MAX_CHARS}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-3">
          <Field label={s.kindLabel}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {s.kinds[k].label}
                </option>
              ))}
            </Select>
          </Field>
          <ImportanceSelect value={importance} onChange={setImportance} />
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!trimmed}>
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
