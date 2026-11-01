import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { invalidateConversation } from '@/api/queries/conversations';
import { isAbortError, StreamDroppedError, streamTurn } from '@/api/sse';
import type { Citation, TurnDone, TurnStep } from '@/api/types';
import { applyTitle, refreshTitles } from './conversationCache';

export type TurnStatus = 'idle' | 'streaming' | 'done' | 'error' | 'aborted';

/** One agent step as the transcript shows it, live or saved. */
export type StepView = {
  /** Unique within the turn; the same on the step's start and end. */
  id: string;
  index: number;
  tool: string;
  args?: unknown;
  ms?: number;
  /** What the tool found, in a few words ("3 passages from 2 sources"). */
  summary?: string;
  running: boolean;
  ok: boolean;
};

export type TurnError = {
  code: string;
  message: string;
  dropped?: boolean;
};

/** A 429 before the answer started: which limit, and how long until it ends. */
export type TurnLimit = { code: string; message: string; retryAfterSec: number };

/** How `send` ended, for callers that react once rather than render the state. */
export type TurnOutcome = { limit?: TurnLimit };

export type TurnState = {
  status: TurnStatus;
  question: string;
  useMemory: boolean;
  steps: StepView[];
  text: string;
  citations: Citation[];
  error?: TurnError;
  done?: TurnDone;
  /** How many saved messages came before this question; the live exchange takes the place after. */
  baseline: number;
  /** The saved messages when it was asked, to tell the ones this turn wrote from the rest. */
  known: ReadonlySet<string>;
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
  known: new Set(),
  startedAt: 0,
  endedAt: 0,
};

export type SendOptions = {
  useMemory: boolean;
  /** Replace the failed attempt of this same question instead of adding another. */
  retry?: boolean;
  baseline: number;
  known: ReadonlySet<string>;
};

function upsertStep(steps: StepView[], step: TurnStep): StepView[] {
  const running = step.status === 'start';
  const at = steps.findIndex((s) => s.id === step.id);
  if (at === -1) {
    return [
      ...steps,
      {
        id: step.id,
        index: step.index,
        tool: step.tool,
        args: step.args,
        ms: step.ms,
        summary: step.summary,
        running,
        ok: step.ok ?? true,
      },
    ];
  }
  const copy = steps.slice();
  const before = copy[at]!;
  copy[at] = {
    ...before,
    args: step.args ?? before.args,
    ms: step.ms ?? before.ms,
    summary: step.summary ?? before.summary,
    running,
    ok: step.ok ?? before.ok,
  };
  return copy;
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

type Client = ReturnType<typeof useQueryClient>;

/**
 * A stopped or dropped turn is saved by the server on its own time, so the refetch right at
 * the end can come back before the partial answer is there. Look again shortly.
 */
function refetchSoon(client: Client, workspaceId: string, conversationId: string) {
  for (const delay of [1500, 5000]) {
    setTimeout(() => invalidateConversation(client, workspaceId, conversationId), delay);
  }
}

/**
 * A conversation's first question names it at once, and a model title replaces that once the
 * answer has been read (the server waits about half a minute). Look again after both.
 */
function refreshTitlesLater(client: Client, workspaceId: string, conversationId: string) {
  for (const delay of [35_000, 70_000]) {
    setTimeout(() => refreshTitles(client, workspaceId, conversationId), delay);
  }
}

async function runTurn(
  client: Client,
  workspaceId: string,
  conversationId: string,
  question: string,
  { useMemory, retry, baseline, known }: SendOptions,
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
    known,
    startedAt: Date.now(),
  }));

  const firstQuestion = baseline === 0;
  let first = true;
  try {
    for await (const ev of streamTurn(
      conversationId,
      { content: question, useMemory, retry: retry || undefined },
      ac.signal,
    )) {
      // The server names the conversation before anything else, and says so in a `title` event;
      // if that event doesn't come, the first thing that does means the name is already saved.
      if (first) {
        first = false;
        if (firstQuestion && ev.event !== 'title')
          refreshTitles(client, workspaceId, conversationId);
      }
      switch (ev.event) {
        case 'title':
          applyTitle(client, workspaceId, conversationId, ev.data.title);
          break;
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
      refetchSoon(client, workspaceId, conversationId);
    } else if (error instanceof StreamDroppedError) {
      finish(entry, {
        status: 'error',
        error: { code: 'DROPPED', message: error.message, dropped: true },
      });
      refetchSoon(client, workspaceId, conversationId);
    } else if (isApiError(error) && error.status === 429) {
      // Nothing was saved; the caller puts the question back and says when to ask again.
      if (entry.frame !== null) cancelAnimationFrame(entry.frame);
      entry.controller = null;
      update(entry, () => idle);
      return {
        limit: {
          code: error.code,
          message: error.message,
          retryAfterSec: error.retryAfterSec ?? 60,
        },
      };
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
      finish(entry, { status: 'error', error: { code: error.code, message: error.message } });
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
      if (firstQuestion) refreshTitlesLater(client, workspaceId, conversationId);
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
    (question: string, options: SendOptions) =>
      runTurn(client, workspaceId, conversationId, question, options),
    [client, conversationId, workspaceId],
  );
  const stop = useCallback(() => entryOf(conversationId).controller?.abort(), [conversationId]);

  return { turn, send, stop };
}
