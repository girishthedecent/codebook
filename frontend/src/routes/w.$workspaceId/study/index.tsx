import { createFileRoute } from '@tanstack/react-router';
import { studySearchSchema, type StudySearch } from '@/features/study/search';
import { StudyPage } from '@/features/study/StudyPage';

export const Route = createFileRoute('/w/$workspaceId/study/')({
  validateSearch: studySearchSchema,
  component: StudyIndex,
});

function StudyIndex() {
  const { workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const setSearch = (patch: Partial<StudySearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return <StudyPage workspaceId={workspaceId} search={search} setSearch={setSearch} />;
}
