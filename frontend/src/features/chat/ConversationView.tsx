import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import type { Message } from '@/api/types';
import { useMe } from '@/auth/useMe';
import { useBreakpoint } from '@/lib/breakpoints';
import { Button, Callout, ChipButton, EmptyState, PageLoading } from '@/ui';
import { shellStrings } from '@/features/shell/strings';
import { Composer } from './Composer';
import { ConversationHeader } from './ConversationHeader';
import { saveDraft } from './drafts';
import { Exchange, fromLive, fromSaved, type ExchangeView } from './Exchange';
import { peekHandOff, takeHandOff } from './handoff';
import { LimitPanel } from './LimitPanel';
import { chat } from './strings';
import { useAskLimit } from './useAskLimit';
import { useMessages } from './useMessages';
import { useStickToBottom } from './useStickToBottom';
import { useTurn } from './useTurn';
import { useWorkspaceSources } from './useWorkspaceSources';

const FAILED = new Set<ExchangeView['state']>(['error', 'aborted']);

/**
 * Pairs saved messages into question/answer exchanges, oldest first. Attempts at the same
 * question that didn't finish, one after another (from before a retry replaced the failed
 * try), fold into the newest of them.
 */
function exchanges(messages: Message[]): ExchangeView[] {
  const out: ExchangeView[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    let view: ExchangeView;
    if (m.role === 'USER') {
      const next = messages[i + 1];
      const answer = next?.role === 'ASSISTANT' ? next : undefined;
      view = fromSaved(m, answer);
      if (answer) i++;
    } else {
      view = fromSaved(undefined, m);
    }
    const before = out.at(-1);
    if (
      before &&
      FAILED.has(before.state) &&
      FAILED.has(view.state) &&
      before.question === view.question
    ) {
      out[out.length - 1] = { ...view, earlier: before.earlier + 1 };
    } else {
      out.push(view);
    }
  }
  return out;
}

/** A conversation still named "New conversation" borrows the start of its first question. */
function titleOf(title: string | undefined, firstQuestion: string | undefined) {
  if (title !== chat.untitled || !firstQuestion) return title;
  const words = firstQuestion.replace(/\s+/g, ' ').trim();
  return words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words;
}

export function ConversationView({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const { isGuest } = useMe();
  const { query, conversation, messages, complete } = useMessages(conversationId);
  const { turn, send, stop } = useTurn(workspaceId, conversationId);
  const { sources } = useWorkspaceSources(workspaceId);
  const { limit, block, expired } = useAskLimit();
  const phone = useBreakpoint() === 'phone';
  const baseline = turn.baseline;

  // `replace` is the failed exchange a retry stands in for: the server drops its messages.
  const ask = useCallback(
    async (question: string, useMemory: boolean, replace = 0) => {
      const outcome = await send(question, {
        useMemory,
        retry: replace > 0 || undefined,
        baseline: messages.length - replace,
        known: new Set(messages.map((m) => m.id)),
      });
      // Refused before it began: nothing was saved, so the question waits in the draft.
      if (outcome.limit) {
        saveDraft(conversationId, question);
        block({
          code: outcome.limit.code,
          resetAt: Date.now() + outcome.limit.retryAfterSec * 1000,
          question,
        });
      }
    },
    [block, conversationId, messages, send],
  );

  // A first question handed over from the workspace home. The timeout lets StrictMode's
  // throwaway mount cancel it, so the turn starts exactly once.
  useEffect(() => {
    if (!peekHandOff(conversationId)) return;
    const t = setTimeout(() => {
      const q = takeHandOff(conversationId);
      if (q) void ask(q.content, q.useMemory);
    }, 0);
    return () => clearTimeout(t);
  }, [conversationId, ask]);

  // Once the conversation has been refetched after the turn and holds the reply the turn wrote,
  // the saved messages take over. Until then the live turn stays on screen, partial text and
  // all: a stopped or dropped answer is saved on the server's own time, and a request that
  // never arrived is never saved at all.
  const ended = turn.status === 'done' || turn.status === 'error' || turn.status === 'aborted';
  const wrote = messages.some((m) => m.role === 'ASSISTANT' && !turn.known.has(m.id));
  const reloaded = ended && query.dataUpdatedAt > turn.endedAt && !query.isFetching && wrote;
  // Once handed over, stay handed over: a later refetch (the title arriving, a window
  // refocus) must not swap the saved answer back for the live one.
  const [handedOver, setHandedOver] = useState(0);
  if (reloaded && handedOver !== turn.endedAt) setHandedOver(turn.endedAt);
  const settled = ended && (reloaded || handedOver === turn.endedAt);
  const live = turn.status !== 'idle' && !settled;
  const pending = turn.status === 'idle' ? peekHandOff(conversationId) : undefined;

  const saved = useMemo(
    () => exchanges(live ? messages.slice(0, baseline) : messages),
    [live, messages, baseline],
  );

  // An exchange keeps the key it had while it streamed, so handing over to the saved copy
  // updates it in place instead of rebuilding it.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const lastSaved = saved.at(-1);
  if (settled && lastSaved && !(lastSaved.key in keys)) {
    setKeys({ ...keys, [lastSaved.key]: `turn-${turn.startedAt}` });
  }
  const rows = saved.map((view) => ({ view, key: keys[view.key] ?? view.key }));
  if (live) rows.push({ view: fromLive(turn, 'live'), key: `turn-${turn.startedAt}` });
  else if (pending) {
    rows.push({
      view: fromLive({ ...turn, status: 'streaming' }, 'pending', pending.content),
      key: 'pending',
    });
  }

  const streaming = turn.status === 'streaming';
  const { atBottom, jump } = useStickToBottom({
    streaming,
    content: `${rows.length}:${turn.text.length}:${turn.steps.length}:${turn.status}:${turn.citations.length}`,
    // Open at the newest message, which in a long conversation is on the last page.
    ready: query.isSuccess && complete,
  });

  const retry = useCallback(
    (view: ExchangeView) => {
      // Only a saved failure has messages to replace; a live one that never reached the
      // server has none.
      const replace =
        view.messageId && view.messageId === messages.at(-1)?.id ? view.messageCount : 0;
      void ask(view.question, turn.useMemory, replace);
      // The Try again button goes away with the failed answer; keep the keyboard where it was useful.
      if (!phone) document.getElementById(`composer-${conversationId}`)?.focus();
    },
    [ask, conversationId, messages, phone, turn.useMemory],
  );

  if (query.isError && isApiError(query.error, 404)) {
    return (
      <div className="mx-auto w-full max-w-narrow px-4 py-12 sm:px-6">
        <EmptyState
          action={
            <Button asChild variant="secondary">
              <Link to="/w/$workspaceId" params={{ workspaceId }}>
                {isGuest ? shellStrings.backToDemo : chat.newInstead}
              </Link>
            </Button>
          }
        >
          {chat.notFound}
        </EmptyState>
      </div>
    );
  }
  const loadFailed = query.isError && !query.data;
  const newest = rows.at(-1)?.view;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <ConversationHeader
        workspaceId={workspaceId}
        conversationId={conversationId}
        title={titleOf(conversation?.title, rows[0]?.view.question)}
      />

      <div className="mx-auto w-full max-w-narrow flex-1 px-4 sm:px-6">
        {loadFailed ? (
          <Callout error={query.error} onRetry={() => void query.refetch()} className="my-8">
            {chat.loadFailed}
          </Callout>
        ) : query.isPending && !pending ? (
          <PageLoading label={chat.loading} rows={2} className="py-8" />
        ) : (
          <div>
            {rows.map(({ view, key }) => (
              <Exchange
                key={key}
                view={view}
                conversationId={conversationId}
                showMeta={!isGuest}
                onRetry={view === newest && !streaming ? retry : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {!atBottom && streaming && (
        <div className="pointer-events-none sticky bottom-[7.5rem] z-20 flex h-0 justify-center max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(10.5rem+env(safe-area-inset-bottom))]">
          <ChipButton
            onClick={jump}
            className="pointer-events-auto -translate-y-full bg-paper shadow-float"
          >
            {chat.jumpToLatest}
          </ChipButton>
        </div>
      )}

      <p className="sr-only" role="status">
        {turn.status === 'done' ? chat.answerReady : turn.status === 'aborted' ? chat.stopped : ''}
      </p>
      <p className="sr-only" role="alert">
        {turn.status === 'error' ? (turn.error?.dropped ? chat.dropped : chat.failed) : ''}
      </p>

      {limit ? (
        <LimitPanel limit={limit} isGuest={isGuest} onExpired={expired} />
      ) : (
        <Composer
          draftScope={conversationId}
          streaming={streaming}
          isGuest={isGuest}
          hasSources={sources.length > 0}
          placeholder={rows.length ? chat.placeholderFollowUp : chat.placeholder}
          focusOnMount
          onSend={(q, m) => void ask(q, m)}
          onStop={stop}
        />
      )}
    </div>
  );
}
