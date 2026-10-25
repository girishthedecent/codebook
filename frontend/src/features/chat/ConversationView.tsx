import { useCallback, useEffect, useMemo, useState } from 'react';
import { isApiError } from '@/api/client';
import type { Message, TurnDone } from '@/api/types';
import { useMe } from '@/auth/useMe';
import { ChipButton, Spinner } from '@/ui';
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
  const { query, conversation, messages } = useMessages(conversationId);
  const { turn, send, stop } = useTurn(workspaceId, conversationId);
  const [baseline, setBaseline] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState<number>();
  const [restore, setRestore] = useState<{ text: string; at: number }>();
  // Usage and latency only come with the live `done` event; kept for the saved messages.
  const [meta, setMeta] = useState<Record<string, TurnDone>>({});

  const ask = useCallback(
    async (question: string, useMemory: boolean) => {
      const previous = turn.done;
      if (previous) setMeta((m) => ({ ...m, [previous.messageId]: previous }));
      setBaseline(messages.length);
      const outcome = await send(question, useMemory);
      // Rate limited: nothing was saved, so the question goes back into the box with a countdown.
      if (outcome.rateLimited) {
        setBlockedUntil(Date.now() + outcome.rateLimited.retryAfter * 1000);
        setRestore({ text: question, at: Date.now() });
      }
    },
    [messages.length, send, turn.done],
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

  // Once the conversation has been refetched after the turn, the saved messages take over —
  // unless nothing was saved (the request never reached the server), then the live turn
  // stays with its error and retry.
  const ended = turn.status === 'done' || turn.status === 'error' || turn.status === 'aborted';
  const settled =
    ended && query.dataUpdatedAt > turn.endedAt && !query.isFetching && messages.length > baseline;
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
    ready: query.isSuccess,
  });

  if (query.isError && isApiError(query.error, 404)) {
    return <p className="mx-auto max-w-[720px] px-4 py-16 text-ink-2">{chat.notFound}</p>;
  }

  return (
    <div className="flex min-h-full flex-col">
      <ConversationHeader
        workspaceId={workspaceId}
        conversationId={conversationId}
        title={conversation?.title}
      />

      <div className="mx-auto w-full max-w-[720px] flex-1 px-4 md:px-6">
        {query.isPending && !pending ? (
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
                onRetry={streaming ? undefined : (q) => void ask(q, turn.useMemory)}
              />
            ))}
          </div>
        )}
      </div>

      {!atBottom && streaming && (
        <div className="pointer-events-none sticky bottom-28 z-20 flex justify-center max-[719px]:fixed max-[719px]:inset-x-0 max-[719px]:bottom-[calc(9rem+env(safe-area-inset-bottom))]">
          <ChipButton onClick={jump} className="pointer-events-auto bg-paper shadow-float">
            {chat.jumpToLatest}
          </ChipButton>
        </div>
      )}

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
