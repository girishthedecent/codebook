import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { flatItems } from '@/api/queries/keys';
import {
  isStudyPending,
  useDeleteStudy,
  useRegenerateStudy,
  useStudies,
} from '@/api/queries/study';
import type { Study, StudyType } from '@/api/types';
import {
  Button,
  ChipButton,
  Dialog,
  Menu,
  MenuItem,
  MenuSeparator,
  ProgressRule,
  Spinner,
} from '@/ui';
import { cn } from '@/lib/cn';
import { relativeDate } from './format';
import { s, statusLabel, typeLabel } from './strings';

const filters: (StudyType | undefined)[] = [undefined, 'QUIZ', 'FLASHCARDS', 'MINDMAP', 'SUMMARY'];

type Props = {
  workspaceId: string;
  selectedId?: string;
  readOnly: boolean;
  onCreate: () => void;
};

/** The workspace's study sets as hairline rows, newest first, with a kind filter. */
export function StudyList({ workspaceId, selectedId, readOnly, onCreate }: Props) {
  const [type, setType] = useState<StudyType | undefined>();
  const query = useStudies(workspaceId, type);
  const studies = flatItems(query.data);

  return (
    <section aria-labelledby="study-heading" className="flex min-h-0 flex-col">
      <header className="flex h-12 items-center justify-between gap-2 px-4">
        <h1 id="study-heading" className="text-sm font-semibold">
          {s.title}
        </h1>
        {!readOnly && (
          <Button size="sm" variant="secondary" onClick={onCreate}>
            {s.newSet}
          </Button>
        )}
      </header>
      {readOnly && <p className="px-4 pb-2 text-xs text-ink-3">{s.guestNote}</p>}

      <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1.5 px-4 pb-3">
        {filters.map((f) => (
          <ChipButton key={f ?? 'all'} pressed={type === f} onClick={() => setType(f)}>
            {f ? typeLabel[f] : 'All'}
          </ChipButton>
        ))}
      </div>

      {query.isPending ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-3">
          <Spinner className="size-3.5" label="Loading study sets" /> Loading
        </div>
      ) : query.isError ? (
        <p className="px-4 py-3 text-sm text-error">{query.error.message}</p>
      ) : studies.length === 0 ? (
        <div className="px-4 py-3 text-sm text-ink-2">
          <p>{s.empty}</p>
          {!readOnly && !type && <p className="mt-1 text-ink-3">{s.emptyHint}</p>}
        </div>
      ) : (
        <ul className="border-t border-rule">
          {studies.map((study) => (
            <StudyRow
              key={study.id}
              study={study}
              workspaceId={workspaceId}
              selected={study.id === selectedId}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}

      {query.hasNextPage && (
        <div className="px-4 py-3">
          <Button
            size="sm"
            variant="ghost"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {s.loadMore}
          </Button>
        </div>
      )}
    </section>
  );
}

function StudyRow({
  study,
  workspaceId,
  selected,
  readOnly,
}: {
  study: Study;
  workspaceId: string;
  selected: boolean;
  readOnly: boolean;
}) {
  const pending = isStudyPending(study);
  return (
    <li className={cn('relative border-b border-rule', selected && 'bg-paper-2')}>
      <div className="flex items-start gap-2 pr-2">
        <Link
          to="/w/$workspaceId/study/$studyId"
          params={{ workspaceId, studyId: study.id }}
          aria-current={selected ? 'page' : undefined}
          className="min-w-0 flex-1 px-4 py-2.5 hover:bg-paper-2/70"
        >
          <span className="flex items-baseline gap-2 font-mono text-xs text-ink-3">
            <span>{typeLabel[study.type].toLowerCase()}</span>
            <span aria-hidden>·</span>
            <span>{relativeDate(study.createdAt)}</span>
            {study.status !== 'DONE' && (
              <>
                <span aria-hidden>·</span>
                <span className={cn(study.status === 'FAILED' && 'text-error')}>
                  {statusLabel[study.status]}
                </span>
              </>
            )}
          </span>
          <span
            className={cn(
              'mt-0.5 block truncate text-sm',
              selected ? 'font-medium text-ink' : 'text-ink',
            )}
          >
            {study.title}
          </span>
          {study.status === 'FAILED' && study.error && (
            <span className="mt-0.5 block truncate text-xs text-ink-3">{study.error}</span>
          )}
        </Link>
        {!readOnly && <RowMenu study={study} workspaceId={workspaceId} />}
      </div>
      {pending && (
        <ProgressRule
          label={`${statusLabel[study.status]}: ${study.title}`}
          className="absolute inset-x-0 bottom-0"
        />
      )}
    </li>
  );
}

export function RowMenu({ study, workspaceId }: { study: Study; workspaceId: string }) {
  const regenerate = useRegenerateStudy(workspaceId);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Menu
        align="end"
        trigger={
          <button
            type="button"
            aria-label={`Actions for ${study.title}`}
            className="mt-2 flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink"
          >
            <DotsThree size={18} weight="bold" />
          </button>
        }
      >
        <MenuItem
          disabled={isStudyPending(study) || regenerate.isPending}
          onSelect={() => regenerate.mutate(study.id)}
        >
          {s.regenerate}
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={() => setConfirm(true)}>
          {s.delete}
        </MenuItem>
      </Menu>
      <DeleteStudyDialog
        study={study}
        workspaceId={workspaceId}
        open={confirm}
        onOpenChange={setConfirm}
      />
    </>
  );
}

export function DeleteStudyDialog({
  study,
  workspaceId,
  open,
  onOpenChange,
  onDeleted,
}: {
  study: Study;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const remove = useDeleteStudy(workspaceId);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={s.deleteTitle}
      description={s.deleteBody}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(study.id, {
                onSuccess: () => {
                  onOpenChange(false);
                  onDeleted?.();
                },
              })
            }
          >
            {s.delete}
          </Button>
        </>
      }
    >
      <p className="truncate font-medium">{study.title}</p>
      {remove.isError && <p className="mt-2 text-error">{remove.error.message}</p>}
    </Dialog>
  );
}
