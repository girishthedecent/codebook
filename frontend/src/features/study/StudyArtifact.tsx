import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { isStudyPending, useRegenerateStudy, useStudy } from '@/api/queries/study';
import type { StudyDetail } from '@/api/types';
import { Button, ProgressRule, Spinner } from '@/ui';
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
    <div className="px-4 py-4 sm:px-6">
      {showBack && (
        <Link
          to="/w/$workspaceId/study"
          params={{ workspaceId }}
          className="mb-3 inline-flex min-h-11 items-center text-sm text-ink-2 hover:text-ink"
        >
          ← {s.back}
        </Link>
      )}
      {query.isPending ? (
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Spinner label="Loading study set" /> Loading
        </div>
      ) : query.isError ? (
        <p className="text-sm text-error">{query.error.message}</p>
      ) : (
        <Loaded
          study={query.data}
          workspaceId={workspaceId}
          readOnly={readOnly}
          search={search}
          setSearch={setSearch}
        />
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
  const [confirm, setConfirm] = useState(false);
  const content = studyContent(study);
  const index = citationIndex(study);
  const pending = isStudyPending(study);

  return (
    <>
      <header className="max-w-[680px]">
        <p className="font-mono text-xs text-ink-3">
          {typeLabel[study.type].toLowerCase()}
          {content && ` · ${countLabel(content)}`} · {relativeDate(study.createdAt)}
        </p>
        <h2 className="mt-1 text-lg font-semibold">{study.title}</h2>
        {!readOnly && !pending && (
          <div className="mt-2 flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              loading={regenerate.isPending}
              onClick={() => regenerate.mutate(study.id)}
            >
              {s.regenerate}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              {s.delete}
            </Button>
          </div>
        )}
        {regenerate.isError && (
          <p className="mt-2 text-sm text-error">{regenerate.error.message}</p>
        )}
      </header>

      <div className="mt-6">
        {pending ? (
          <div className="max-w-[480px]">
            <ProgressRule label={s.making} />
            <p className="mt-3 text-sm text-ink-2">
              {study.status === 'PENDING' ? s.queued : s.making}
            </p>
          </div>
        ) : study.status === 'FAILED' ? (
          <div className="max-w-[560px] border-l-2 border-error pl-4">
            <p className="text-sm font-medium">{s.failed}</p>
            {study.error && <p className="mt-1 text-sm text-ink-2">{study.error}</p>}
          </div>
        ) : !content ? (
          <p className="text-sm text-ink-3">{s.failed}</p>
        ) : content.type === 'QUIZ' ? (
          <QuizPlayer key={study.updatedAt} quiz={content.data} index={index} />
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
