import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import type { Message, TurnDone } from '@/api/types';
import { useMe } from '@/auth/useMe';
import { useBreakpoint } from '@/lib/breakpoints';
import { Button, ChipButton, Spinner } from '@/ui';
import { Composer } from './Composer';
import { ConversationHeader } from './ConversationHeader';
import { Exchange, fromLive, fromSaved, type ExchangeView } from './Exchange';
import { peekHandOff, takeHandOff } from './handoff';
import { chat } from './strings';
import { useMessages } from './useMessages';
import { useStickToBottom } from './useStickToBottom';
import { useTurn } from './useTurn';

/** Pairs saved messages into question/answer exchanges, oldest first. */
function exchanges(messages: Message[]): ExchangeView[] {
  const out: ExchangeView[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'USER') {
      const next = messages[i + 1];
      const answer = next?.role === 'ASSISTANT' ? next : undefined;
      out.push(fromSaved(m, answer));
      if (answer) i++;
    } else {
      out.push(fromSaved(undefined, m));
    }
  }
  return out;
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
  const phone = useBreakpoint() === 'phone';
  const baseline = turn.baseline;
  const [blockedUntil, setBlockedUntil] = useState<number>();
  const [restore, setRestore] = useState<{ text: string; at: number }>();
  // Usage and latency only come with the live `done` event; kept for the saved messages.
  const [meta, setMeta] = useState<Record<string, TurnDone>>({});

  const ask = useCallback(
    async (question: string, useMemory: boolean) => {
      const previous = turn.done;
      if (previous) setMeta((m) => ({ ...m, [previous.messageId]: previous }));
      const outcome = await send(question, useMemory, messages.length);
      // Rate limited: nothing was saved, so the question goes back into the box with a countdown.
      if (outcome.rateLimited) {
        setBlockedUntil(Date.now() + outcome.rateLimited.retryAfter * 1000);
        setRestore({ text: question, at: Date.now() });
      }
    },
    [messages.length, send, turn.done],
  );

  const retry = (question: string) => {
    void ask(question, turn.useMemory);
    // The Try again button goes away with the failed answer; keep the keyboard where it was useful.
    if (!phone) document.getElementById(`composer-${conversationId}`)?.focus();
  };

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

  // Once the conversation has been refetched after the turn, the saved messages take over —
  // unless nothing was saved (the request never reached the server), then the live turn
  // stays with its error and retry.
  const ended = turn.status === 'done' || turn.status === 'error' || turn.status === 'aborted';
  const reloaded =
    ended && query.dataUpdatedAt > turn.endedAt && !query.isFetching && messages.length > baseline;
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
  const doneById = turn.done ? { ...meta, [turn.done.messageId]: turn.done } : meta;
  const views: ExchangeView[] = saved.map((v) =>
    v.messageId && doneById[v.messageId] ? { ...v, done: doneById[v.messageId] } : v,
  );
  if (live) views.push(fromLive(turn));
  else if (pending) {
    views.push(fromLive({ ...turn, status: 'streaming', question: pending.content }));
  }

  const streaming = turn.status === 'streaming';
  const { atBottom, jump } = useStickToBottom({
    streaming,
    content: `${views.length}:${turn.text.length}:${turn.steps.length}`,
    // Open at the newest message, which in a long conversation is on the last page.
    ready: query.isSuccess && complete,
  });

  if (query.isError && isApiError(query.error, 404)) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 md:px-6">
        <p className="text-ink-2">{chat.notFound}</p>
        <Link
          to="/w/$workspaceId"
          params={{ workspaceId }}
          className="mt-3 inline-flex text-sm text-accent underline underline-offset-2 max-[719px]:min-h-11 max-[719px]:items-center"
        >
          {chat.newInstead}
        </Link>
      </div>
    );
  }
  const loadFailed = query.isError && !query.data;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <ConversationHeader
        workspaceId={workspaceId}
        conversationId={conversationId}
        title={conversation?.title}
      />

      <div className="mx-auto w-full max-w-[720px] flex-1 px-4 md:px-6">
        {loadFailed ? (
          <div className="py-10">
            <p className="text-sm text-ink-2">{chat.loadFailed}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 max-[719px]:h-11"
              onClick={() => void query.refetch()}
            >
              {chat.retry}
            </Button>
          </div>
        ) : query.isPending && !pending ? (
          <div className="flex items-center gap-2 py-10 text-xs text-ink-3">
            <Spinner className="size-3.5" /> {chat.loading}
          </div>
        ) : (
          <div className="divide-y divide-rule">
            {views.map((v) => (
              <Exchange
                key={v.key}
                view={v}
                conversationId={conversationId}
                showMeta={!isGuest}
                onRetry={streaming ? undefined : retry}
              />
            ))}
          </div>
        )}
      </div>

      {!atBottom && streaming && (
        <div className="pointer-events-none sticky bottom-[7.5rem] z-20 flex h-0 justify-center max-[719px]:fixed max-[719px]:inset-x-0 max-[719px]:bottom-[calc(10.5rem+env(safe-area-inset-bottom))]">
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

      <Composer
        draftScope={conversationId}
        streaming={streaming}
        isGuest={isGuest}
        blockedUntil={blockedUntil}
        restore={restore}
        placeholder={views.length ? chat.placeholderFollowUp : chat.placeholder}
        focusOnMount
        onSend={(q, m) => void ask(q, m)}
        onStop={stop}
      />
    </div>
  );
}
