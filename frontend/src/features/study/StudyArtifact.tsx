import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { isStudyPending, useCancelStudy, useRegenerateStudy, useStudy } from '@/api/queries/study';
import type { StudyDetail } from '@/api/types';
import { Link } from '@tanstack/react-router';
import { BackLink, Button, ProgressRule, Spinner } from '@/ui';
import { ErrorLine } from './ErrorLine';
import { DeleteStudyDialog } from './StudyList';
import { citationIndex, itemCount, studyContent, type StudyContent } from './data';
import { Flashcards } from './Flashcards';
import { relativeDate } from './format';
import { MindMap } from './MindMap';
import { QuizPlayer } from './QuizPlayer';
import type { StudySearch } from './search';
import { s, typeLabel } from './strings';
import { Summary } from './Summary';

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
  const query = useStudy(studyId);

  return (
    <div className="px-4 py-4 pb-8 sm:px-6">
      {showBack && (
        <BackLink
          to="/w/$workspaceId/study"
          params={{ workspaceId }}
          search={{ kind: search.kind }}
          className="mb-3"
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
        <div className="flex flex-col gap-3">
          <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
          {/* Phones already have the back link above. */}
          {!showBack && (
            <Link
              to="/w/$workspaceId/study"
              params={{ workspaceId }}
              className="text-sm text-accent underline underline-offset-2"
            >
              {s.back}
            </Link>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Spinner label="Loading study set" /> Loading
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
  const pending = isStudyPending(study);
  // Regenerating swaps the buttons for a progress line, so focus would be lost with them.
  const title = useRef<HTMLHeadingElement>(null);
  const remake = () => regenerate.mutate(study.id, { onSuccess: () => title.current?.focus() });

  return (
    <>
      <header className="max-w-[680px]">
        <p className="font-mono text-xs text-ink-3">
          {typeLabel[study.type].toLowerCase()}
          {content && ` · ${countLabel(content)}`} · {relativeDate(study.createdAt)}
        </p>
        <h2 ref={title} tabIndex={-1} className="mt-1 text-lg font-semibold outline-none">
          {study.title}
        </h2>
        {!readOnly && !pending && (
          <div className="mt-2 flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-10! md:h-7!"
              loading={regenerate.isPending}
              onClick={remake}
            >
              {s.regenerate}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-10! md:h-7!"
              onClick={() => setConfirm(true)}
            >
              {s.delete}
            </Button>
          </div>
        )}
        {regenerate.isError && (
          <p role="alert" className="mt-2 text-sm text-error">
            {regenerate.error.message}
          </p>
        )}
      </header>

      <div className="mt-6">
        {pending ? (
          <div className="max-w-[480px]">
            <ProgressRule label={s.making} />
            <p role="status" className="mt-3 text-sm text-ink-2">
              {study.status === 'PENDING' ? s.queued : s.making}
            </p>
            <p className="mt-1 text-xs text-ink-3">{s.leaveHint}</p>
            {!readOnly && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-10! md:h-7!"
                loading={cancel.isPending}
                onClick={() => cancel.mutate(study.id)}
              >
                {s.cancel}
              </Button>
            )}
            {cancel.isError && (
              <p role="alert" className="mt-2 text-sm text-error">
                {cancel.error.message}
              </p>
            )}
          </div>
        ) : study.status === 'FAILED' ? (
          <div className="max-w-[560px] border-l-2 border-error pl-4">
            <p className="text-sm font-medium">{s.failed}</p>
            {study.error && <p className="mt-1 text-sm text-ink-2">{study.error}</p>}
            {!readOnly && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 h-10! md:h-7!"
                loading={regenerate.isPending}
                onClick={remake}
              >
                {s.retry}
              </Button>
            )}
          </div>
        ) : !content ? (
          <p className="max-w-[560px] text-sm text-ink-2">{s.unreadable}</p>
        ) : content.type === 'QUIZ' ? (
          <QuizPlayer
            key={study.updatedAt}
            storageKey={`quiz:${study.id}:${study.updatedAt}`}
            quiz={content.data}
            index={index}
          />
        ) : content.type === 'FLASHCARDS' ? (
          <Flashcards deck={content.data} index={index} search={search} setSearch={setSearch} />
        ) : content.type === 'MINDMAP' ? (
          <MindMap key={study.updatedAt} map={content.data} index={index} />
        ) : (
          <Summary summary={content.data} index={index} />
        )}
      </div>

      <DeleteStudyDialog
        study={study}
        workspaceId={workspaceId}
        open={confirm}
        onOpenChange={setConfirm}
        onDeleted={() => void navigate({ to: '/w/$workspaceId/study', params: { workspaceId } })}
      />
    </>
  );
}

function countLabel(content: StudyContent) {
  const n = itemCount(content);
  switch (content.type) {
    case 'QUIZ':
      return `${n} question${n === 1 ? '' : 's'}`;
    case 'FLASHCARDS':
      return `${n} card${n === 1 ? '' : 's'}`;
    case 'MINDMAP':
      return `${n} topics`;
    case 'SUMMARY':
      return `${n} section${n === 1 ? '' : 's'}`;
  }
}
