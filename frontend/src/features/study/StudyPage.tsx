import { useState } from 'react';
import { useMe } from '@/auth/useMe';
import { useBreakpoint } from '@/lib/breakpoints';
import { CreateStudy } from './CreateStudy';
import { StudyArtifact } from './StudyArtifact';
import { StudyList } from './StudyList';
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
  const { isGuest } = useMe();
  const [creating, setCreating] = useState(false);

  const list = (
    <StudyList
      workspaceId={workspaceId}
      selectedId={studyId}
      readOnly={isGuest}
      onCreate={() => setCreating(true)}
    />
  );
  const artifact = studyId ? (
    <StudyArtifact
      workspaceId={workspaceId}
      studyId={studyId}
      readOnly={isGuest}
      showBack={phone}
      search={search}
      setSearch={setSearch}
    />
  ) : (
    <p className="px-6 py-4 text-sm text-ink-3">{s.pickOne}</p>
  );

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
      {!isGuest && (
        <CreateStudy workspaceId={workspaceId} open={creating} onOpenChange={setCreating} />
      )}
    </>
  );
}
