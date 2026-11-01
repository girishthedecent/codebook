import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { flatItems } from '@/api/queries/keys';
import { useConversations, useCreateConversation } from '@/api/queries/conversations';
import { useDemo } from '@/api/queries/demo';
import { useWorkspace } from '@/api/queries/workspaces';
import type { Source } from '@/api/types';
import { useMe } from '@/auth/useMe';
import { Button, Callout, EmptyState, SectionHeading, Skeleton, SourceBadge } from '@/ui';
import { useBreakpoint } from '@/lib/breakpoints';
import { displayTitle } from '@/lib/displayTitle';
import { Composer } from './Composer';
import { clearDraft, saveDraft } from './drafts';
import { handOff } from './handoff';
import { LimitPanel } from './LimitPanel';
import { chat } from './strings';
import { useAskLimit } from './useAskLimit';
import { useWorkspaceSources } from './useWorkspaceSources';
import { seedMessages } from './useMessages';

/** Questions to start with for a workspace the curator didn't write any for. */
function suggestions(sources: Source[]): string[] {
  const ready = sources.filter((s) => s.status === 'READY');
  const book = ready.find((s) => s.type === 'PDF');
  const repo = ready.find((s) => s.type === 'GITHUB_REPO');
  const site = ready.find((s) => s.type === 'WEBSITE');
  const bookName = book && displayTitle(book).name;
  const repoName = repo && displayTitle(repo).name;
  const out: string[] = [];
  if (bookName) out.push(`What is “${bookName}” mostly about, and what does it ask of the reader?`);
  if (repoName) out.push(`How is ${repoName} organised, and where would I start reading?`);
  if (bookName && repoName) {
    out.push(`Which ideas in “${bookName}” show up in the code of ${repoName}?`);
  }
  if (site) out.push(`What does “${displayTitle(site).name}” cover, in a few sentences?`);
  return out.slice(0, 4);
}

const number = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : undefined);
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What a source holds, in a few words: "491 pages", "100 files, 155 symbols". */
function counts(source: Source): string {
  if (source.status === 'FAILED') return 'Could not be read';
  if (source.status !== 'READY') return 'Still being read';
  const stats = source.stats as { pages?: unknown; files?: unknown; graph?: { symbols?: unknown } };
  if (source.type === 'GITHUB_REPO') {
    const files = number(stats.files);
    const symbols = number(stats.graph?.symbols);
    return [files !== undefined && plural(files, 'file'), symbols && plural(symbols, 'symbol')]
      .filter(Boolean)
      .join(', ');
  }
  const pages = number(stats.pages);
  return pages === undefined ? '' : plural(pages, 'page');
}

/**
 * The workspace home, set out like a title page: the name, what it holds, and questions to
 * begin with. Nothing exists on the server until a question is asked; then the conversation is
 * made and the question is handed to its page, which starts the answer at once.
 */
export function ChatHome({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { isGuest } = useMe();
  const phone = useBreakpoint() === 'phone';
  const workspace = useWorkspace(workspaceId);
  const demo = useDemo().data;
  const inDemo = demo?.workspace.id === workspaceId;
  const { sources, known: sourcesKnown } = useWorkspaceSources(workspaceId);
  const create = useCreateConversation(workspaceId);
  const { limit, expired } = useAskLimit();
  const [failed, setFailed] = useState(false);
  // Bumped to make the box read its draft again after a question was put back.
  const [boxKey, setBoxKey] = useState(0);
  const draftScope = `new:${workspaceId}`;

  const ask = (question: string, useMemory: boolean, typed = true) => {
    if (create.isPending || limit) return;
    setFailed(false);
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
      onError: () => {
        setFailed(true);
        // The box was emptied when it sent; a typed question goes back so it isn't lost.
        if (typed) {
          saveDraft(draftScope, question);
          setBoxKey((k) => k + 1);
        }
      },
    });
  };

  const name = workspace.data?.name ?? (inDemo ? demo.workspace.name : undefined);
  const description = workspace.data?.description ?? (inDemo ? demo.workspace.description : null);
  const ideas =
    inDemo && demo.starterQuestions.length > 0 ? demo.starterQuestions : suggestions(sources);
  const empty = sourcesKnown && sources.length === 0;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="mx-auto w-full max-w-narrow flex-1 px-4 pt-8 pb-8 sm:px-6 sm:pt-16">
        <header>
          {name ? (
            <h1 className="heading-display text-ink [overflow-wrap:anywhere]">{name}</h1>
          ) : (
            <Skeleton className="h-11 w-3/5" />
          )}
          {description && (
            <p className="mt-3 max-w-prose font-serif text-base text-pretty text-ink-2">
              {description}
            </p>
          )}
        </header>

        {empty && (
          <EmptyState
            className="mt-6"
            action={
              <Button asChild variant="secondary">
                <Link to="/w/$workspaceId/sources" params={{ workspaceId }}>
                  {chat.home.addSource}
                </Link>
              </Button>
            }
          >
            {chat.home.noSources}
          </EmptyState>
        )}

        {sources.length > 0 && (
          <section className="mt-10" aria-labelledby="home-sources">
            <SectionHeading id="home-sources" hint={chat.home.sourcesHint}>
              {chat.home.sourcesHeading}
            </SectionHeading>
            <ul>
              {sources.map((source) => (
                <SourceLine key={source.id} workspaceId={workspaceId} source={source} />
              ))}
            </ul>
          </section>
        )}

        {ideas.length > 0 && (
          <section className="mt-10" aria-labelledby="home-ideas">
            <SectionHeading id="home-ideas">{chat.home.ideasHeading}</SectionHeading>
            <ol>
              {ideas.map((question, i) => (
                <li key={question}>
                  <button
                    type="button"
                    disabled={create.isPending || Boolean(limit)}
                    onClick={() => ask(question, !isGuest, false)}
                    className="group flex min-h-11 w-full items-baseline gap-3 py-2 text-left disabled:opacity-50"
                  >
                    <span className="w-5 shrink-0 text-right font-serif text-base text-ink-3 oldstyle-nums tabular-nums">
                      {i + 1}.
                    </span>
                    <span className="font-serif text-base text-ink group-hover:underline group-hover:decoration-ink-3 group-hover:underline-offset-2">
                      {question}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        {create.isPending && (
          <p className="mt-4 text-xs text-ink-3" role="status">
            {chat.home.starting}
          </p>
        )}
        {failed && (
          <Callout tone="error" className="mt-4">
            {chat.home.createFailed}
          </Callout>
        )}

        {phone && <RecentConversations workspaceId={workspaceId} />}
      </div>

      {limit ? (
        <LimitPanel limit={limit} isGuest={isGuest} onExpired={expired} />
      ) : (
        <Composer
          key={boxKey}
          draftScope={draftScope}
          streaming={false}
          isGuest={isGuest}
          hasSources={sources.length > 0}
          focusOnMount
          onSend={(q, m) => ask(q, m)}
          onStop={() => undefined}
        />
      )}
    </div>
  );
}

function SourceLine({ workspaceId, source }: { workspaceId: string; source: Source }) {
  const { name, ref } = displayTitle(source);
  const detail = counts(source);
  return (
    <li>
      <Link
        to="/w/$workspaceId/sources/$sourceId"
        params={{ workspaceId, sourceId: source.id }}
        className="group flex min-h-11 items-baseline gap-3 py-2"
      >
        <SourceBadge type={source.type} className="translate-y-1.5 self-center" />
        <span className="min-w-0 font-serif text-base text-ink group-hover:underline group-hover:decoration-ink-3 group-hover:underline-offset-2 [overflow-wrap:anywhere]">
          {name}
          {ref && <span className="ml-1.5 text-xs text-ink-3 tabular-nums">{ref}</span>}
        </span>
        <span
          aria-hidden
          className="h-0 min-w-4 flex-1 -translate-y-1 border-b border-dotted border-edge"
        />
        <span className="shrink-0 text-xs text-ink-3 tabular-nums">{detail}</span>
      </Link>
    </li>
  );
}

/** Phones have no sidebar, so recent conversations sit on the home page. */
function RecentConversations({ workspaceId }: { workspaceId: string }) {
  const recent = flatItems(useConversations(workspaceId).data).slice(0, 6);
  if (recent.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="home-recent">
      <SectionHeading id="home-recent">{chat.conversations}</SectionHeading>
      <ul>
        {recent.map((c) => (
          <li key={c.id}>
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
