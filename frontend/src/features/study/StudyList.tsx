import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { flatItems } from '@/api/queries/keys';
import {
  studiesQueryOptions,
  useCancelStudy,
  useDeleteStudy,
  useRegenerateStudy,
} from '@/api/queries/study';
import type { Study, StudyType } from '@/api/types';
import {
  Button,
  Callout,
  ChipButton,
  Dialog,
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  ProgressRule,
  Skeleton,
  StatusDot,
  TextLink,
} from '@/ui';
import { cn } from '@/lib/cn';
import { relativeDate } from './format';
import { isStale, studyState } from './state';
import { s, typeLabel } from './strings';

const filters: (StudyType | undefined)[] = [undefined, 'QUIZ', 'FLASHCARDS', 'MINDMAP', 'SUMMARY'];

/** The list polls while something is being made, and stops for one that looks stalled. */
export function useStudyList(workspaceId: string, type?: StudyType) {
  const base = studiesQueryOptions(workspaceId, type);
  return useInfiniteQuery({
    ...base,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some((study) => studyState(study).making && !isStale(study)),
      )
        ? 3000
        : false,
  });
}

type Props = {
  workspaceId: string;
  selectedId?: string;
  /** The kind filter; lives in the URL so it survives opening a set and coming back. */
  kind?: StudyType;
  onKind: (kind: StudyType | undefined) => void;
  readOnly: boolean;
  /** Visitors without an account are told how to make their own. */
  guest: boolean;
  onCreate: () => void;
};

/** The workspace's study sets, newest first, with a kind filter. */
export function StudyList({
  workspaceId,
  selectedId,
  kind: type,
  onKind,
  readOnly,
  guest,
  onCreate,
}: Props) {
  const query = useStudyList(workspaceId, type);
  const studies = flatItems(query.data);

  return (
    <section aria-labelledby="study-heading" className="flex min-h-0 flex-col">
      <header className="flex flex-col gap-2 px-4 pt-5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 id="study-heading" className="heading-page">
            {s.title}
          </h1>
          {!readOnly && (
            <Button size="sm" variant="primary" onClick={onCreate}>
              {s.newSet}
            </Button>
          )}
        </div>
        {readOnly && (
          <p className="text-xs text-pretty text-ink-3">
            {guest ? s.guestNote : s.demoNote}{' '}
            {guest && (
              <TextLink
                to="/sign-in"
                search={{ next: window.location.pathname + window.location.search }}
                className="inline-flex min-h-6 items-center"
              >
                {s.signIn}
              </TextLink>
            )}
          </p>
        )}
      </header>

      <div role="group" aria-label={s.filterLabel} className="flex flex-wrap gap-2 px-4 pb-4">
        {filters.map((f) => (
          <ChipButton key={f ?? 'all'} pressed={type === f} onClick={() => onKind(f)}>
            {f ? typeLabel[f] : s.all}
          </ChipButton>
        ))}
      </div>

      {query.isPending ? (
        <div role="status" className="flex flex-col gap-2 px-4">
          <span className="sr-only">{s.loading}</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : query.isError && studies.length === 0 ? (
        <div className="px-4">
          <Callout error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : studies.length === 0 ? (
        <div className="px-4">
          <EmptyState className="py-4">{type ? s.emptyFiltered : s.empty}</EmptyState>
          {!readOnly && !type && <p className="text-xs text-ink-3">{s.emptyHint}</p>}
        </div>
      ) : (
        <ul className="px-2">
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
          <Callout error={query.error} onRetry={() => void query.refetch()} />
        </div>
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
  kind,
  readOnly,
}: {
  study: Study;
  workspaceId: string;
  selected: boolean;
  kind?: StudyType;
  readOnly: boolean;
}) {
  const state = studyState(study);
  const navigate = useNavigate();
  const regenerate = useRegenerateStudy(workspaceId);
  const cancel = useCancelStudy(workspaceId);
  return (
    <li className={cn('relative rounded-sm', selected && 'bg-paper-3')}>
      <div className="flex items-start gap-1 pr-1">
        <Link
          to="/w/$workspaceId/study/$studyId"
          params={{ workspaceId, studyId: study.id }}
          search={{ kind }}
          aria-current={selected ? 'page' : undefined}
          className="min-w-0 flex-1 rounded-sm px-2 py-2.5 hover:bg-paper-2"
        >
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
            <span>{typeLabel[study.type]}</span>
            <span aria-hidden>·</span>
            <span>{relativeDate(study.createdAt)}</span>
            {state.tone && (
              <StatusDot tone={state.tone} label={state.label} className="ml-1 text-ink-3" />
            )}
          </span>
          <span className="mt-0.5 block text-sm text-pretty text-ink [overflow-wrap:anywhere]">
            {study.title}
          </span>
          {state.failed && study.error && (
            <span className="mt-0.5 block text-xs text-ink-3">{state.reason}</span>
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
      {(regenerate.isError || cancel.isError) && (
        <p role="alert" className="px-2 pb-2 text-xs text-error">
          {(regenerate.error ?? cancel.error)?.message}
        </p>
      )}
      {state.making && !isStale(study) && (
        <ProgressRule
          label={`${state.label}: ${study.title}`}
          className="absolute inset-x-2 bottom-0 w-auto"
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
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Actions for ${study.title}`}
            className="mt-1 size-9 px-0 max-sm:size-11"
          >
            <DotsThree size={18} weight="bold" aria-hidden />
          </Button>
        }
      >
        {studyState(study).making ? (
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
  study: Pick<Study, 'id' | 'title'>;
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
            {s.cancelDialog}
          </Button>
          <Button
            variant="danger"
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
      <p className="font-medium [overflow-wrap:anywhere]">{study.title}</p>
      {remove.isError && <p className="mt-2 text-error">{remove.error.message}</p>}
    </Dialog>
  );
}
