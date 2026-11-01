import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { isApiError } from '@/api/client';
import { flatItems } from '@/api/queries/keys';
import { useSources } from '@/api/queries/sources';
import { useCreateStudy } from '@/api/queries/study';
import type { CreateStudyBody, StudyType } from '@/api/types';
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  Field,
  Input,
  RadioGroup,
  Select,
  SourceBadge,
  Textarea,
  TextButton,
  TextLink,
  Sheet,
} from '@/ui';
import { displayTitle } from '@/lib/displayTitle';
import { useBreakpoint } from '@/lib/breakpoints';
import { s, typeDescription, typeLabel } from './strings';

// Mirrors appConfig.study in the backend; the server checks again.
const countRange: Partial<Record<StudyType, { min: number; max: number; default: number }>> = {
  QUIZ: { min: 5, max: 20, default: 10 },
  FLASHCARDS: { min: 5, max: 40, default: 15 },
};
const MAX_SOURCES = 10;
const types: StudyType[] = ['QUIZ', 'FLASHCARDS', 'MINDMAP', 'SUMMARY'];
const difficulties = ['easy', 'medium', 'hard'] as const;

type Props = { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void };

/** A dialog on wide screens, a bottom sheet on phones; same form in both. */
export function CreateStudy({ workspaceId, open, onOpenChange }: Props) {
  const phone = useBreakpoint() === 'phone';
  const body = open ? (
    <CreateStudyForm workspaceId={workspaceId} onDone={() => onOpenChange(false)} />
  ) : null;
  return phone ? (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={s.create.title}
      description={s.create.description}
    >
      <div className="px-4 pb-6">{body}</div>
    </Sheet>
  ) : (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s.create.title}
      description={s.create.description}
    >
      {body}
    </Dialog>
  );
}

function CreateStudyForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const navigate = useNavigate();
  const create = useCreateStudy(workspaceId);
  const sourcesQuery = useSources(workspaceId);
  const all = flatItems(sourcesQuery.data);
  const ready = all.filter((src) => src.status === 'READY');
  const stillIndexing = all.some((src) => src.status === 'PENDING' || src.status === 'PROCESSING');

  const [type, setType] = useState<StudyType>('QUIZ');
  // undefined = the ready sources, up to the most one set can use; a set once the user picks.
  const [picked, setPicked] = useState<Set<string> | undefined>();
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState<number | undefined>();
  const [difficulty, setDifficulty] = useState<(typeof difficulties)[number]>('medium');

  const range = countRange[type];
  const preselected = ready.slice(0, MAX_SOURCES).map((src) => src.id);
  const sourceIds = picked ? [...picked] : preselected;
  const tooMany = sourceIds.length > MAX_SOURCES;
  const chosenCount = range ? (count ?? range.default) : undefined;
  const badCount =
    range !== undefined &&
    chosenCount !== undefined &&
    (!Number.isInteger(chosenCount) || chosenCount < range.min || chosenCount > range.max);
  const canSubmit = sourceIds.length > 0 && !tooMany && !badCount && !create.isPending;

  const toggle = (id: string) => {
    const next = new Set(picked ?? preselected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const body: CreateStudyBody = {
      type,
      sourceIds,
      topic: topic.trim() || undefined,
      count: chosenCount,
      difficulty: type === 'QUIZ' ? difficulty : undefined,
    };
    create.mutate(body, {
      onSuccess: (study) => {
        onDone();
        void navigate({
          to: '/w/$workspaceId/study/$studyId',
          params: { workspaceId, studyId: study.id },
        });
      },
    });
  };

  if (sourcesQuery.isError) {
    return <Callout error={sourcesQuery.error} onRetry={() => void sourcesQuery.refetch()} />;
  }
  if (sourcesQuery.isSuccess && ready.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="font-serif text-base text-ink-2">
          {stillIndexing ? s.sourcesIndexing : s.noSources}
        </p>
        <TextLink
          to="/w/$workspaceId/sources"
          params={{ workspaceId }}
          onClick={onDone}
          className="inline-flex min-h-11 items-center"
        >
          {s.sourcesLink}
        </TextLink>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Group legend={s.create.type}>
        <RadioGroup
          aria-label={s.create.type}
          value={type}
          onValueChange={(v) => setType(v as StudyType)}
          options={types.map((t) => ({
            value: t,
            label: typeLabel[t],
            description: typeDescription[t],
          }))}
        />
      </Group>

      <Group
        legend={s.create.sources}
        error={
          tooMany
            ? s.create.tooManySources
            : sourceIds.length === 0 && ready.length > 0
              ? s.create.noneSelected
              : undefined
        }
        note={ready.length > MAX_SOURCES && !picked ? s.create.firstTen : undefined}
        action={
          ready.length > 1 && (
            <TextButton
              className="inline-flex min-h-10 items-center text-sm"
              onClick={() => setPicked(sourceIds.length > 0 ? new Set() : undefined)}
            >
              {sourceIds.length > 0 ? s.create.selectNone : s.create.selectAll}
            </TextButton>
          )
        }
      >
        <ul className="max-h-52 overflow-y-auto">
          {ready.map((src) => {
            const { name, ref } = displayTitle(src);
            return (
              <li key={src.id}>
                <Checkbox
                  checked={sourceIds.includes(src.id)}
                  onCheckedChange={() => toggle(src.id)}
                  label={
                    <span className="flex items-center gap-2">
                      <SourceBadge type={src.type} />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
                      {ref && <span className="font-mono text-xs text-ink-3">@{ref}</span>}
                    </span>
                  }
                />
              </li>
            );
          })}
        </ul>
      </Group>

      <div className="flex flex-wrap gap-4">
        {range && (
          <Field
            label={s.create.count(type)}
            hint={`${range.min}–${range.max}`}
            error={badCount ? s.create.countRange(range.min, range.max) : undefined}
            className="w-28"
          >
            <Input
              type="number"
              inputMode="numeric"
              min={range.min}
              max={range.max}
              value={count ?? range.default}
              onChange={(e) => setCount(e.target.value === '' ? undefined : Number(e.target.value))}
            />
          </Field>
        )}
        {type === 'QUIZ' && (
          <Field label={s.create.difficulty} className="w-36">
            <Select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as (typeof difficulties)[number])}
            >
              {difficulties.map((d) => (
                <option key={d} value={d}>
                  {d[0]!.toUpperCase() + d.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <Field
        label={s.create.topic}
        hint={topic.trim() ? undefined : s.create.sampled}
        note={s.create.optional}
      >
        <Textarea
          rows={2}
          maxLength={500}
          value={topic}
          placeholder={s.create.topicHint}
          onChange={(e) => setTopic(e.target.value)}
        />
      </Field>

      {create.isError && <CreateError error={create.error} />}

      <div className="flex justify-end gap-2 border-t border-rule pt-4">
        <Button type="button" variant="ghost" onClick={onDone}>
          {s.create.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit} loading={create.isPending}>
          {s.create.submit}
        </Button>
      </div>
    </form>
  );
}

/** A 429 says when the allowance comes back; anything else shows what the server said. */
function CreateError({ error }: { error: Error }) {
  const [now] = useState(() => Date.now());
  if (isApiError(error, 429)) {
    const seconds = error.retryAfterSec;
    const reset = seconds
      ? new Date(now + seconds * 1000).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })
      : undefined;
    return (
      <Callout tone="warn">{reset ? s.create.limit(`at ${reset}`) : s.create.limitSoon}</Callout>
    );
  }
  return <Callout error={error} />;
}

function Group({
  legend,
  error,
  note,
  action,
  children,
}: {
  legend: string;
  error?: string;
  note?: string;
  /** A small control on the legend's row, e.g. select all. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-1 flex w-full items-center justify-between text-xs font-medium text-ink">
        {legend}
        {action}
      </legend>
      {note && <p className="mb-1 text-xs text-ink-3">{note}</p>}
      {children}
      {error && <p className="text-xs text-error">{error}</p>}
    </fieldset>
  );
}
