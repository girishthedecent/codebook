import { createFileRoute } from '@tanstack/react-router';
import { studyQueryOptions } from '@/api/queries/study';
import { studySearchSchema, type StudySearch } from '@/features/study/search';
import { StudyPage } from '@/features/study/StudyPage';

export const Route = createFileRoute('/w/$workspaceId/study/$studyId')({
  validateSearch: studySearchSchema,
  // Start fetching on hover of the row; the page renders from the cache.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(studyQueryOptions(params.studyId));
  },
  component: StudyDetailRoute,
});

function StudyDetailRoute() {
  const { workspaceId, studyId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const setSearch = (patch: Partial<StudySearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return (
    // A new set starts at its first card with empty piles.
    <StudyPage
      key={studyId}
      workspaceId={workspaceId}
      studyId={studyId}
      search={search}
      setSearch={setSearch}
    />
  );
}
