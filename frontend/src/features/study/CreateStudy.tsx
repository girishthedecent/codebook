import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { flatItems } from '@/api/queries/keys';
import { useSources } from '@/api/queries/sources';
import { useCreateStudy } from '@/api/queries/study';
import type { CreateStudyBody, StudyType } from '@/api/types';
import { Button, Dialog, Field, Input, Sheet, Textarea } from '@/ui';
import { useBreakpoint } from '@/lib/breakpoints';
import { ErrorLine } from './ErrorLine';
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
  // undefined = every ready source (the default); a set once the user narrows it.
  const [picked, setPicked] = useState<Set<string> | undefined>();
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState<number | undefined>();
  const [difficulty, setDifficulty] = useState<(typeof difficulties)[number]>('medium');

  const range = countRange[type];
  const sourceIds = picked ? [...picked] : ready.map((src) => src.id);
  const tooMany = sourceIds.length > MAX_SOURCES;
  const chosenCount = range ? (count ?? range.default) : undefined;
  const badCount =
    range !== undefined &&
    chosenCount !== undefined &&
    (!Number.isInteger(chosenCount) || chosenCount < range.min || chosenCount > range.max);
  const canSubmit = sourceIds.length > 0 && !tooMany && !badCount && !create.isPending;

  const toggle = (id: string) => {
    const next = new Set(picked ?? ready.map((src) => src.id));
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
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-2">{s.sourcesFailed}</p>
        <ErrorLine error={sourcesQuery.error} onRetry={() => void sourcesQuery.refetch()} />
      </div>
    );
  }
  if (sourcesQuery.isSuccess && ready.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 text-sm text-ink-2">
        <p>{stillIndexing ? s.sourcesIndexing : s.noSources}</p>
        <Link
          to="/w/$workspaceId/sources"
          params={{ workspaceId }}
          onClick={onDone}
          className="inline-flex min-h-11 items-center text-accent underline underline-offset-2"
        >
          {s.sourcesLink}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Group legend={s.create.type}>
        <ul className="divide-y divide-rule rounded-sm border border-rule">
          {types.map((t) => (
            <li key={t}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-paper-2 has-[:checked]:bg-paper-2">
                <input
                  type="radio"
                  aria-label={typeLabel[t]}
                  name="study-type"
                  value={t}
                  checked={type === t}
                  onChange={() => setType(t)}
                  className="mt-1 accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium">{typeLabel[t]}</span>
                  <span className="block text-xs text-ink-2">{typeDescription[t]}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
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
        action={
          ready.length > 1 && (
            <button
              type="button"
              className="min-h-11 text-xs text-accent underline underline-offset-2 md:min-h-6"
              onClick={() => setPicked(sourceIds.length === ready.length ? new Set() : undefined)}
            >
              {sourceIds.length === ready.length ? s.create.selectNone : s.create.selectAll}
            </button>
          )
        }
      >
        <ul className="max-h-48 overflow-y-auto rounded-sm border border-rule">
          {ready.map((src) => (
            <li key={src.id} className="border-b border-rule last:border-b-0">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-paper-2">
                <input
                  type="checkbox"
                  checked={sourceIds.includes(src.id)}
                  onChange={() => toggle(src.id)}
                  className="accent-accent"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{src.title}</span>
                <span className="font-mono text-xs text-ink-3">{sourceKind[src.type]}</span>
              </label>
            </li>
          ))}
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
          <Group legend={s.create.difficulty}>
            <div className="flex h-9 items-center gap-4">
              {difficulties.map((d) => (
                <label
                  key={d}
                  className="flex min-h-11 cursor-pointer items-center gap-1.5 text-sm"
                >
                  <input
                    type="radio"
                    name="difficulty"
                    value={d}
                    checked={difficulty === d}
                    onChange={() => setDifficulty(d)}
                    className="accent-accent"
                  />
                  {d[0]!.toUpperCase() + d.slice(1)}
                </label>
              ))}
            </div>
          </Group>
        )}
      </div>

      <Field label={s.create.topic} hint={s.create.topicHint}>
        <Textarea
          rows={2}
          maxLength={500}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </Field>

      {create.isError && <p className="text-sm text-error">{create.error.message}</p>}

      <div className="flex justify-end gap-2 border-t border-rule pt-4">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit} loading={create.isPending}>
          {s.create.submit}
        </Button>
      </div>
    </form>
  );
}

const sourceKind = { PDF: 'book', GITHUB_REPO: 'repo', WEBSITE: 'site' } as const;

function Group({
  legend,
  error,
  action,
  children,
}: {
  legend: string;
  error?: string;
  /** A small control on the legend's row, e.g. select all. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 flex w-full items-center justify-between text-xs font-medium text-ink">
        {legend}
        {action}
      </legend>
      {children}
      {error && <p className="text-xs text-error">{error}</p>}
    </fieldset>
  );
}
