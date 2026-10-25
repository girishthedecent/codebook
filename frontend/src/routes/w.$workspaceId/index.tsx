import { createFileRoute } from '@tanstack/react-router';
import { ChatHome } from '@/features/chat/ChatHome';

// Workspace home: ask a new question.
export const Route = createFileRoute('/w/$workspaceId/')({
  component: function WorkspaceHome() {
    const { workspaceId } = Route.useParams();
    return <ChatHome workspaceId={workspaceId} />;
  },
});
