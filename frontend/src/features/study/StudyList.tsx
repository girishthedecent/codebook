import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { flatItems } from '@/api/queries/keys';
import {
  isStudyPending,
  useCancelStudy,
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
import { ErrorLine } from './ErrorLine';
import { relativeDate } from './format';
import { s, statusLabel, typeLabel } from './strings';

const filters: (StudyType | undefined)[] = [undefined, 'QUIZ', 'FLASHCARDS', 'MINDMAP', 'SUMMARY'];

type Props = {
  workspaceId: string;
  selectedId?: string;
  /** The kind filter; lives in the URL so it survives opening a set and coming back. */
  kind?: StudyType;
  onKind: (kind: StudyType | undefined) => void;
  readOnly: boolean;
  /** Why it's read-only, shown under the heading. */
  note?: string;
  onCreate: () => void;
};

/** The workspace's study sets as hairline rows, newest first, with a kind filter. */
export function StudyList({
  workspaceId,
  selectedId,
  kind: type,
  onKind,
  readOnly,
  note = s.guestNote,
  onCreate,
}: Props) {
  const query = useStudies(workspaceId, type);
  const studies = flatItems(query.data);

  return (
    <section aria-labelledby="study-heading" className="flex min-h-0 flex-col">
      <header className="flex h-12 items-center justify-between gap-2 px-4">
        <h1 id="study-heading" className="text-sm font-semibold">
          {s.title}
        </h1>
        {!readOnly && (
          <Button size="sm" variant="secondary" className="h-10! md:h-7!" onClick={onCreate}>
            {s.newSet}
          </Button>
        )}
      </header>
      {readOnly && <p className="px-4 pb-2 text-xs text-ink-3">{note}</p>}

      <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1.5 px-4 pb-3">
        {filters.map((f) => (
          <ChipButton
            key={f ?? 'all'}
            className="h-10! px-3! md:h-6! md:px-2!"
            pressed={type === f}
            onClick={() => onKind(f)}
          >
            {f ? typeLabel[f] : 'All'}
          </ChipButton>
        ))}
      </div>

      {query.isPending ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-3">
          <Spinner className="size-3.5" label="Loading study sets" /> Loading
        </div>
      ) : query.isError && studies.length === 0 ? (
        <div className="px-4 py-3">
          <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : studies.length === 0 ? (
        <div className="px-4 py-3 text-sm text-ink-2">
          <p>{type ? s.emptyFiltered : s.empty}</p>
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
              kind={type}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}

      {query.isError && studies.length > 0 && (
        <div className="px-4 py-3">
          <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
        </div>
      )}

      {query.hasNextPage && (
        <div className="px-4 py-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-10! md:h-7!"
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
  kind,
  readOnly,
}: {
  study: Study;
  workspaceId: string;
  selected: boolean;
  kind?: StudyType;
  readOnly: boolean;
}) {
  const pending = isStudyPending(study);
  const navigate = useNavigate();
  const regenerate = useRegenerateStudy(workspaceId);
  const cancel = useCancelStudy(workspaceId);
  return (
    <li className={cn('relative border-b border-rule', selected && 'bg-paper-2')}>
      <div className="flex items-start gap-2 pr-2">
        <Link
          to="/w/$workspaceId/study/$studyId"
          params={{ workspaceId, studyId: study.id }}
          search={{ kind }}
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
        {!readOnly && (
          <RowMenu
            study={study}
            workspaceId={workspaceId}
            regenerating={regenerate.isPending}
            onRegenerate={() => regenerate.mutate(study.id)}
            onCancel={() => cancel.mutate(study.id)}
            // The open set is gone; leave its page rather than show a not-found.
            onDeleted={
              selected
                ? () =>
                    void navigate({
                      to: '/w/$workspaceId/study',
                      params: { workspaceId },
                      search: { kind },
                    })
                : undefined
            }
          />
        )}
      </div>
      {regenerate.isError && (
        <p role="alert" className="px-4 pb-2 text-xs text-error">
          {regenerate.error.message}
        </p>
      )}
      {cancel.isError && (
        <p role="alert" className="px-4 pb-2 text-xs text-error">
          {cancel.error.message}
        </p>
      )}
      {pending && (
        <ProgressRule
          label={`${statusLabel[study.status]}: ${study.title}`}
          className="absolute inset-x-0 bottom-0"
        />
      )}
    </li>
  );
}

function RowMenu({
  study,
  workspaceId,
  regenerating,
  onRegenerate,
  onCancel,
  onDeleted,
}: {
  study: Study;
  workspaceId: string;
  regenerating: boolean;
  onRegenerate: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Menu
        align="end"
        trigger={
          <button
            type="button"
            aria-label={`Actions for ${study.title}`}
            className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink"
          >
            <DotsThree size={18} weight="bold" />
          </button>
        }
      >
        {isStudyPending(study) ? (
          <MenuItem onSelect={onCancel}>{s.cancel}</MenuItem>
        ) : (
          <MenuItem disabled={regenerating} onSelect={onRegenerate}>
            {s.regenerate}
          </MenuItem>
        )}
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
        onDeleted={onDeleted}
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
      onOpenChange={(next) => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
      size="sm"
      title={s.deleteTitle}
      description={s.deleteBody}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={remove.isPending}>
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
