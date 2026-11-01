import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { flatItems } from '@/api/queries/keys';
import { useSources } from '@/api/queries/sources';
import {
  attemptsOf,
  studyQueryOptions,
  useCancelStudy,
  useRegenerateStudy,
} from '@/api/queries/study';
import type { StudyDetail } from '@/api/types';
import { displayTitle } from '@/lib/displayTitle';
import { BackLink, Button, Callout, ProgressRule, Skeleton, TextLink } from '@/ui';
import { DeleteStudyDialog } from './StudyList';
import { citationIndex, itemCount, studyContent, type StudyContent } from './data';
import { Flashcards } from './Flashcards';
import { relativeDate } from './format';
import { MindMap } from './MindMap';
import { QuizPlayer } from './QuizPlayer';
import { QuizSheet } from './QuizSheet';
import type { StudySearch } from './search';
import { isStale, studyState } from './state';
import { s, typeLabel } from './strings';
import { StudyExport } from './StudyExport';
import { Summary } from './Summary';
import './study.css';

type Props = {
  workspaceId: string;
  studyId: string;
  readOnly: boolean;
  /** Phones show a back link to the list above the artifact. */
  showBack: boolean;
  search: StudySearch;
  setSearch: (patch: Partial<StudySearch>) => void;
};

export function StudyArtifact({
  workspaceId,
  studyId,
  readOnly,
  showBack,
  search,
  setSearch,
}: Props) {
  // Polls while the set is being made, and stops for one that looks stalled.
  const query = useQuery({
    ...studyQueryOptions(studyId),
    refetchInterval: (q) =>
      q.state.data && studyState(q.state.data).making && !isStale(q.state.data) ? 3000 : false,
  });

  return (
    <div className="study-print px-4 py-6 pb-10 sm:px-8">
      {showBack && (
        <BackLink
          to="/w/$workspaceId/study"
          params={{ workspaceId }}
          search={{ kind: search.kind }}
          className="study-screen-only mb-3"
        >
          {s.back}
        </BackLink>
      )}
      {query.data ? (
        <Loaded
          study={query.data}
          workspaceId={workspaceId}
          readOnly={readOnly}
          search={search}
          setSearch={setSearch}
        />
      ) : query.isError ? (
        <div className="flex max-w-prose flex-col items-start gap-3">
          <Callout error={query.error} onRetry={() => void query.refetch()} />
          {/* Phones already have the back link above. */}
          {!showBack && (
            <TextLink
              to="/w/$workspaceId/study"
              params={{ workspaceId }}
              className="inline-flex min-h-10 items-center"
            >
              {s.back}
            </TextLink>
          )}
        </div>
      ) : (
        <div role="status" className="flex max-w-prose flex-col gap-3">
          <span className="sr-only">{s.loadingOne}</span>
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-9 w-4/5" />
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
      )}
    </div>
  );
}

function Loaded({
  study,
  workspaceId,
  readOnly,
  search,
  setSearch,
}: {
  study: StudyDetail;
  workspaceId: string;
  readOnly: boolean;
  search: StudySearch;
  setSearch: (patch: Partial<StudySearch>) => void;
}) {
  const navigate = useNavigate();
  const regenerate = useRegenerateStudy(workspaceId);
  const cancel = useCancelStudy(workspaceId);
  const [confirm, setConfirm] = useState(false);
  const content = studyContent(study);
  const index = citationIndex(study);
  const state = studyState(study);
  const stale = isStale(study);
  const { lastAttempt } = attemptsOf(study);
  // Regenerating swaps the buttons for a progress line, so focus would be lost with them.
  const title = useRef<HTMLHeadingElement>(null);
  const remake = () => regenerate.mutate(study.id, { onSuccess: () => title.current?.focus() });

  return (
    <>
      <header className="max-w-prose">
        <p className="text-xs text-ink-3">
          {typeLabel[study.type]}
          {content && ` · ${countLabel(content)}`} · {relativeDate(study.createdAt)}
        </p>
        <h2
          ref={title}
          tabIndex={-1}
          className="heading-page mt-1 outline-none [overflow-wrap:anywhere]"
        >
          {study.title}
        </h2>
        <MadeFrom study={study} workspaceId={workspaceId} />
        {(content || !readOnly) && !state.making && (
          <div className="study-screen-only mt-3 flex flex-wrap gap-1">
            {content && <StudyExport content={content} title={study.title} index={index} />}
            {!readOnly && (
              <>
                <Button size="sm" variant="ghost" loading={regenerate.isPending} onClick={remake}>
                  {s.regenerate}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
                  {s.delete}
                </Button>
              </>
            )}
          </div>
        )}
        {regenerate.isError && <Callout error={regenerate.error} className="mt-3" />}
      </header>

      <div className="mt-8">
        {state.making ? (
          <div className="max-w-md">
            {!stale && <ProgressRule label={s.making} />}
            <p role="status" className="mt-3 font-serif text-base text-ink-2">
              {stale ? s.stale : study.status === 'PENDING' ? s.queued : s.making}
            </p>
            <p className="mt-1 text-xs text-ink-3">{stale ? s.staleHint : s.leaveHint}</p>
            {!readOnly && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                loading={cancel.isPending}
                onClick={() => cancel.mutate(study.id)}
              >
                {s.cancel}
              </Button>
            )}
            {cancel.isError && <Callout error={cancel.error} className="mt-3" />}
          </div>
        ) : state.cancelled ? (
          <div className="max-w-md border-l-2 border-edge pl-4">
            <p className="font-serif text-base text-ink">{s.cancelled}</p>
            <p className="mt-1 text-sm text-ink-3">{s.cancelledHint}</p>
            {!readOnly && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                loading={regenerate.isPending}
                onClick={remake}
              >
                {s.regenerate}
              </Button>
            )}
          </div>
        ) : state.failed ? (
          <Callout
            tone="error"
            title={s.failed}
            className="max-w-xl"
            action={
              !readOnly && (
                <Button size="sm" loading={regenerate.isPending} onClick={remake}>
                  {s.retry}
                </Button>
              )
            }
          >
            {state.reason}
          </Callout>
        ) : !content ? (
          <p className="max-w-prose font-serif text-base text-ink-2">{s.unreadable}</p>
        ) : content.type === 'QUIZ' ? (
          <>
            <div className="study-screen-only">
              <QuizPlayer
                key={study.updatedAt}
                storageKey={`quiz:${study.id}:${study.updatedAt}`}
                quiz={content.data}
                index={index}
                workspaceId={workspaceId}
                studyId={study.id}
                lastAttempt={lastAttempt}
              />
            </div>
            <QuizSheet quiz={content.data} index={index} />
          </>
        ) : content.type === 'FLASHCARDS' ? (
          <Flashcards
            deck={content.data}
            index={index}
            search={search}
            setSearch={setSearch}
            workspaceId={workspaceId}
            studyId={study.id}
            lastAttempt={lastAttempt}
          />
        ) : content.type === 'MINDMAP' ? (
          <MindMap
            key={study.updatedAt}
            map={content.data}
            index={index}
            workspaceId={workspaceId}
            title={study.title}
          />
        ) : (
          <Summary summary={content.data} index={index} />
        )}
      </div>

      <DeleteStudyDialog
        study={study}
        workspaceId={workspaceId}
        open={confirm}
        onOpenChange={setConfirm}
        onDeleted={() =>
          void navigate({
            to: '/w/$workspaceId/study',
            params: { workspaceId },
            search: { kind: search.kind },
          })
        }
      />
    </>
  );
}

/** "Made from the nanoGPT repository, focused on “attention”. 10 questions, medium difficulty." */
function MadeFrom({ study, workspaceId }: { study: StudyDetail; workspaceId: string }) {
  const sources = flatItems(useSources(workspaceId).data);
  const { input } = study;
  const names = input.sourceIds.flatMap((id) => {
    const source = sources.find((src) => src.id === id);
    return source ? [displayTitle(source).name] : [];
  });
  const from = names.length > 0 ? list(names) : s.theSources;
  const scope = input.topic
    ? s.focusedOn(input.topic)
    : input.tocNodeId
      ? s.wholeChapter
      : input.pathPrefix
        ? s.folder(input.pathPrefix)
        : s.spread;
  const size =
    input.count === undefined
      ? undefined
      : study.type === 'QUIZ'
        ? s.questionsCount(input.count)
        : study.type === 'FLASHCARDS'
          ? s.cardsCount(input.count)
          : undefined;
  const extra = [size, study.type === 'QUIZ' ? s.difficulty(input.difficulty) : undefined].filter(
    Boolean,
  );

  return (
    <p className="mt-3 font-serif text-base text-pretty text-ink-2">
      {s.madeFrom} {from}: {scope}.{extra.length > 0 && ` ${capitalize(extra.join(', '))}.`}
    </p>
  );
}

const list = (items: string[]) =>
  items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const capitalize = (text: string) => text[0]!.toUpperCase() + text.slice(1);

function countLabel(content: StudyContent) {
  const n = itemCount(content);
  switch (content.type) {
    case 'QUIZ':
      return s.questionsCount(n);
    case 'FLASHCARDS':
      return s.cardsCount(n);
    case 'MINDMAP':
      return s.topicsCount(n);
    case 'SUMMARY':
      return s.sectionsCount(n);
  }
}
