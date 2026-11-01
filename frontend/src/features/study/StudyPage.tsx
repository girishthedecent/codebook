import { useState } from 'react';
import { useIsDemoWorkspace } from '@/api/queries/demo';
import { useMe } from '@/auth/useMe';
import { useBreakpoint } from '@/lib/breakpoints';
import { CreateStudy } from './CreateStudy';
import { StudyArtifact } from './StudyArtifact';
import { StudyList, useStudyList } from './StudyList';
import type { StudySearch } from './search';
import { s } from './strings';

type Props = {
  workspaceId: string;
  studyId?: string;
  search?: StudySearch;
  setSearch?: (patch: Partial<StudySearch>) => void;
};

/**
 * List beside the open set on tablet and desktop; on phones the list and the set are separate
 * pages. Guests can open what's there but not make or change anything (the backend refuses too).
 */
export function StudyPage({ workspaceId, studyId, search = {}, setSearch = () => {} }: Props) {
  const phone = useBreakpoint() === 'phone';
  const { isGuest: guest, isLoading } = useMe();
  // Until we know who is signed in, show the read-only view rather than buttons that may vanish.
  const signedOut = guest || isLoading;
  // The demo workspace belongs to no one who visits it, so nobody can add to it.
  const isDemo = useIsDemoWorkspace(workspaceId);
  const readOnly = signedOut || isDemo;
  const [creating, setCreating] = useState(false);
  // The list is the empty state when there is nothing to open, so the pane stays quiet then.
  const hasSets = (useStudyList(workspaceId, search.kind).data?.pages[0]?.items.length ?? 0) > 0;

  const list = (
    <StudyList
      workspaceId={workspaceId}
      selectedId={studyId}
      kind={search.kind}
      onKind={(kind) => setSearch({ kind })}
      readOnly={readOnly}
      guest={signedOut}
      onCreate={() => setCreating(true)}
    />
  );
  const artifact = studyId ? (
    <StudyArtifact
      key={studyId}
      workspaceId={workspaceId}
      studyId={studyId}
      readOnly={readOnly}
      showBack={phone}
      search={search}
      setSearch={setSearch}
    />
  ) : hasSets ? (
    <p className="px-6 py-8 font-serif text-base text-ink-3">{s.pickOne}</p>
  ) : null;

  return (
    <>
      {phone ? (
        studyId ? (
          artifact
        ) : (
          list
        )
      ) : (
        <div className="flex min-h-full">
          <div className="w-72 shrink-0 border-r border-rule lg:w-80">{list}</div>
          <div className="min-w-0 flex-1">{artifact}</div>
        </div>
      )}
      {!readOnly && (
        <CreateStudy workspaceId={workspaceId} open={creating} onOpenChange={setCreating} />
      )}
    </>
  );
}
