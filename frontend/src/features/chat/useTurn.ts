import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { invalidateConversation } from '@/api/queries/conversations';
import { keys } from '@/api/queries/keys';
import { isAbortError, StreamDroppedError, streamTurn } from '@/api/sse';
import type { Citation, TurnDone, TurnStep } from '@/api/types';

export type TurnStatus = 'idle' | 'streaming' | 'done' | 'error' | 'aborted';

/** One agent step as the transcript shows it, live or saved. */
export type StepView = {
  index: number;
  tool: string;
  args?: unknown;
  ms?: number;
  running: boolean;
  ok: boolean;
};

export type TurnError = {
  code: string;
  message: string;
  /** Seconds until another question is allowed (429). */
  retryAfter?: number;
  dropped?: boolean;
};

/** How `send` ended, for callers that react once rather than render the state. */
export type TurnOutcome = { rateLimited?: { retryAfter: number } };

export type TurnState = {
  status: TurnStatus;
  question: string;
  useMemory: boolean;
  steps: StepView[];
  text: string;
  citations: Citation[];
  error?: TurnError;
  done?: TurnDone;
  /** How many saved messages the conversation had when the question was asked. */
  baseline: number;
  startedAt: number;
  /** When it ended, so callers can tell a refetch that happened after it. 0 while running. */
  endedAt: number;
};

const idle: TurnState = {
  status: 'idle',
  question: '',
  useMemory: true,
  steps: [],
  text: '',
  citations: [],
  baseline: 0,
  startedAt: 0,
  endedAt: 0,
};

function upsertStep(steps: StepView[], step: TurnStep): StepView[] {
  const next: StepView = {
    index: step.index,
    tool: step.tool,
    args: step.args,
    ms: step.ms,
    running: step.status === 'start',
    ok: true,
  };
  const at = steps.findIndex((s) => s.index === step.index && s.tool === step.tool);
  if (at === -1) return [...steps, next];
  const copy = steps.slice();
  copy[at] = { ...copy[at], ...next, args: next.args ?? copy[at]!.args };
  return copy;
}

/**
 * The backend names a conversation in a background job after the first answer, so the
 * refetch right at the end of the turn still sees the placeholder title. Look again shortly.
 */
function refreshTitleLater(
  client: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  conversationId: string,
) {
  for (const delay of [2500, 7000]) {
    setTimeout(() => {
      void client.invalidateQueries({ queryKey: keys.conversation(conversationId) });
      void client.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
    }, delay);
  }
}

// One entry per conversation, outside React, so a turn keeps streaming while the reader looks
// at another conversation and is still there (or finished and saved) when they come back.
type Entry = {
  state: TurnState;
  controller: AbortController | null;
  buffer: string;
  frame: number | null;
  listeners: Set<() => void>;
};

const entries = new Map<string, Entry>();

function entryOf(conversationId: string): Entry {
  let entry = entries.get(conversationId);
  if (!entry) {
    entry = { state: idle, controller: null, buffer: '', frame: null, listeners: new Set() };
    entries.set(conversationId, entry);
  }
  return entry;
}

function update(entry: Entry, change: (t: TurnState) => TurnState) {
  entry.state = change(entry.state);
  entry.listeners.forEach((l) => l());
}

function flush(entry: Entry) {
  entry.frame = null;
  if (!entry.buffer) return;
  const chunk = entry.buffer;
  entry.buffer = '';
  update(entry, (t) => ({ ...t, text: t.text + chunk }));
}

function finish(entry: Entry, patch: Partial<TurnState>) {
  if (entry.frame !== null) cancelAnimationFrame(entry.frame);
  flush(entry);
  update(entry, (t) => ({
    ...t,
    ...patch,
    endedAt: Date.now(),
    steps: t.steps.map((s) => (s.running ? { ...s, running: false } : s)),
  }));
  entry.controller = null;
}

/** Stops a conversation's turn and forgets it; for a conversation that was deleted. */
export function discardTurn(conversationId: string) {
  const entry = entries.get(conversationId);
  if (!entry) return;
  entry.controller?.abort();
  if (entry.frame !== null) cancelAnimationFrame(entry.frame);
  entries.delete(conversationId);
}

async function runTurn(
  client: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  conversationId: string,
  question: string,
  useMemory: boolean,
  baseline: number,
): Promise<TurnOutcome> {
  const entry = entryOf(conversationId);
  entry.controller?.abort();
  const ac = new AbortController();
  entry.controller = ac;
  entry.buffer = '';
  update(entry, () => ({
    ...idle,
    status: 'streaming',
    question,
    useMemory,
    baseline,
    startedAt: Date.now(),
  }));

  try {
    for await (const ev of streamTurn(
      conversationId,
      { content: question, useMemory },
      ac.signal,
    )) {
      switch (ev.event) {
        case 'step':
          update(entry, (t) => ({ ...t, steps: upsertStep(t.steps, ev.data) }));
          break;
        case 'token':
          entry.buffer += ev.data.text;
          entry.frame ??= requestAnimationFrame(() => flush(entry));
          break;
        case 'citations':
          update(entry, (t) => ({ ...t, citations: ev.data.items }));
          break;
        case 'done':
          finish(entry, { status: 'done', done: ev.data });
          break;
        case 'error':
          finish(entry, { status: 'error', error: ev.data });
          break;
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      finish(entry, { status: 'aborted' });
    } else if (error instanceof StreamDroppedError) {
      finish(entry, {
        status: 'error',
        error: { code: 'DROPPED', message: error.message, dropped: true },
      });
    } else if (isApiError(error) && error.retryAfterSec !== undefined) {
      // Nothing was saved; the caller puts the question back and counts down.
      if (entry.frame !== null) cancelAnimationFrame(entry.frame);
      entry.controller = null;
      update(entry, () => idle);
      return { rateLimited: { retryAfter: error.retryAfterSec } };
    } else if (isApiError(error)) {
      // The stream bypasses the query cache; replaying the 401 through a mutation lets the
      // shell's session-expiry handler (which listens to the cache) send the reader to sign in.
      if (error.status === 401) {
        void client
          .getMutationCache()
          .build(client, { mutationFn: () => Promise.reject(error) })
          .execute(undefined)
          .catch(() => undefined);
      }
      finish(entry, {
        status: 'error',
        error: { code: error.code, message: error.message, retryAfter: error.retryAfterSec },
      });
    } else {
      finish(entry, {
        status: 'error',
        error: { code: 'INTERNAL', message: 'Something went wrong' },
      });
    }
  } finally {
    // A deleted conversation has nothing to refetch.
    if (entries.get(conversationId) === entry) {
      invalidateConversation(client, workspaceId, conversationId);
      refreshTitleLater(client, workspaceId, conversationId);
    }
  }
  return {};
}

/**
 * Runs one chat turn over SSE. Tokens arrive far faster than React needs to paint, so they
 * collect in a buffer that is flushed once per animation frame. When the turn ends, however
 * it ends, the conversation is refetched: the saved messages are the truth after that.
 */
export function useTurn(workspaceId: string, conversationId: string) {
  const client = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = entryOf(conversationId);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    [conversationId],
  );
  const turn = useSyncExternalStore(subscribe, () => entryOf(conversationId).state);

  const send = useCallback(
    (question: string, useMemory: boolean, baseline: number) =>
      runTurn(client, workspaceId, conversationId, question, useMemory, baseline),
    [client, conversationId, workspaceId],
  );
  const stop = useCallback(() => entryOf(conversationId).controller?.abort(), [conversationId]);

  return { turn, send, stop };
}
