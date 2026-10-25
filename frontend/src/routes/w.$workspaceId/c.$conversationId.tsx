import { createFileRoute } from '@tanstack/react-router';
import { ConversationView } from '@/features/chat/ConversationView';

export const Route = createFileRoute('/w/$workspaceId/c/$conversationId')({
  component: function Conversation() {
    const { workspaceId, conversationId } = Route.useParams();
    // Keyed so moving between conversations starts each with a fresh turn and scroll state.
    return (
      <ConversationView
        key={conversationId}
        workspaceId={workspaceId}
        conversationId={conversationId}
      />
    );
  },
});
