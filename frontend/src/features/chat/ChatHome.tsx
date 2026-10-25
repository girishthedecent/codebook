import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { flatItems } from '@/api/queries/keys';
import { useConversations, useCreateConversation } from '@/api/queries/conversations';
import { useSources } from '@/api/queries/sources';
import { useWorkspace } from '@/api/queries/workspaces';
import type { Source } from '@/api/types';
import { useMe } from '@/auth/useMe';
import { useBreakpoint } from '@/lib/breakpoints';
import { Composer } from './Composer';
import { clearDraft } from './drafts';
import { handOff } from './handoff';
import { chat } from './strings';
import { seedMessages } from './useMessages';

/** Questions worth asking, from what the workspace holds. Plain, specific, at most four. */
function suggestions(sources: Source[]): string[] {
  const ready = sources.filter((s) => s.status === 'READY');
  const out: string[] = [];
  const book = ready.find((s) => s.type === 'PDF');
  const repo = ready.find((s) => s.type === 'GITHUB_REPO');
  const site = ready.find((s) => s.type === 'WEBSITE');
  if (book) out.push(`What are the main ideas in ${book.title}?`);
  if (repo) out.push(`Where does a request enter ${repo.title}, and what happens next?`);
  if (book && repo) out.push(`Which ideas from ${book.title} show up in ${repo.title}?`);
  if (site) out.push(`What does ${site.title} explain, in short?`);
  if (repo && out.length < 4) out.push(`How is ${repo.title} organized?`);
  return out.slice(0, 4);
}

/**
 * The workspace home: a fresh question. Asking creates the conversation and moves to its
 * page, which starts the answer at once (the question is handed over, not re-typed).
 */
export function ChatHome({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { isGuest } = useMe();
  const phone = useBreakpoint() === 'phone';
  const workspace = useWorkspace(workspaceId);
  const sources = flatItems(useSources(workspaceId).data);
  const create = useCreateConversation(workspaceId);
  const [error, setError] = useState<string>();
  const draftScope = `new:${workspaceId}`;

  const ask = (question: string, useMemory: boolean) => {
    setError(undefined);
    create.mutate(undefined, {
      onSuccess: (conversation) => {
        seedMessages(client, { ...conversation, messages: { items: [], nextCursor: null } });
        handOff(conversation.id, { content: question, useMemory });
        clearDraft(draftScope);
        void navigate({
          to: '/w/$workspaceId/c/$conversationId',
          params: { workspaceId, conversationId: conversation.id },
        });
      },
      onError: (e) => setError(e.message),
    });
  };

  const ideas = suggestions(sources);
  const noSources = sources.length === 0 && !workspace.isPending;

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-[720px] flex-1 px-4 pt-12 pb-6 md:px-6 md:pt-20">
        <p className="font-mono text-xs text-ink-3">{workspace.data?.name ?? ' '}</p>
        <h1 className="mt-2 font-serif text-xl font-semibold text-ink">
          {noSources ? chat.homeEmpty : chat.homeLine}
        </h1>

        {ideas.length > 0 && (
          <ul className="mt-8 border-t border-rule">
            {ideas.map((q) => (
              <li key={q} className="border-b border-rule">
                <button
                  type="button"
                  disabled={create.isPending}
                  onClick={() => ask(q, !isGuest)}
                  className="w-full py-2.5 text-left font-serif text-base text-ink-2 hover:text-ink disabled:opacity-50 max-[719px]:min-h-11"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="mt-4 text-xs text-error" role="alert">
            {error}
          </p>
        )}

        {phone && <RecentConversations workspaceId={workspaceId} />}
      </div>

      <Composer
        draftScope={draftScope}
        streaming={create.isPending}
        isGuest={isGuest}
        focusOnMount
        onSend={ask}
        onStop={() => undefined}
      />
    </div>
  );
}

/** Phones have no sidebar, so recent conversations sit on the home page. */
function RecentConversations({ workspaceId }: { workspaceId: string }) {
  const recent = flatItems(useConversations(workspaceId).data).slice(0, 6);
  if (recent.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-xs font-medium text-ink-3">{chat.recent}</h2>
      <ul className="mt-2 border-t border-rule">
        {recent.map((c) => (
          <li key={c.id} className="border-b border-rule">
            <Link
              to="/w/$workspaceId/c/$conversationId"
              params={{ workspaceId, conversationId: c.id }}
              className="flex min-h-11 items-center text-sm text-ink-2"
            >
              <span className="truncate">{c.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
