import { createFileRoute } from '@tanstack/react-router';
import { StudyPage } from '@/features/study/StudyPage';

export const Route = createFileRoute('/w/$workspaceId/study/')({
  component: StudyIndex,
});

function StudyIndex() {
  const { workspaceId } = Route.useParams();
  return <StudyPage workspaceId={workspaceId} />;
}
