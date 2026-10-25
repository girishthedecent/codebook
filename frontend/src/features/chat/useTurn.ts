import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { invalidateConversation } from '@/api/queries/conversations';
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
 * Runs one chat turn over SSE. Tokens arrive far faster than React needs to paint, so they
 * collect in a buffer that is flushed once per animation frame. When the turn ends, however
 * it ends, the conversation is refetched: the saved messages are the truth after that.
 */
export function useTurn(workspaceId: string, conversationId: string) {
  const client = useQueryClient();
  const [turn, setTurn] = useState<TurnState>(idle);
  const controller = useRef<AbortController | null>(null);
  const buffer = useRef('');
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    if (!buffer.current) return;
    const chunk = buffer.current;
    buffer.current = '';
    setTurn((t) => ({ ...t, text: t.text + chunk }));
  }, []);

  const finish = useCallback(
    (patch: Partial<TurnState>) => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      flush();
      setTurn((t) => ({
        ...t,
        ...patch,
        endedAt: Date.now(),
        steps: t.steps.map((s) => (s.running ? { ...s, running: false } : s)),
      }));
      controller.current = null;
    },
    [flush],
  );

  const send = useCallback(
    async (question: string, useMemory: boolean): Promise<TurnOutcome> => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      buffer.current = '';
      setTurn({ ...idle, status: 'streaming', question, useMemory, startedAt: Date.now() });

      try {
        for await (const ev of streamTurn(
          conversationId,
          { content: question, useMemory },
          ac.signal,
        )) {
          switch (ev.event) {
            case 'step':
              setTurn((t) => ({ ...t, steps: upsertStep(t.steps, ev.data) }));
              break;
            case 'token':
              buffer.current += ev.data.text;
              frame.current ??= requestAnimationFrame(flush);
              break;
            case 'citations':
              setTurn((t) => ({ ...t, citations: ev.data.items }));
              break;
            case 'done':
              finish({ status: 'done', done: ev.data });
              break;
            case 'error':
              finish({ status: 'error', error: ev.data });
              break;
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          finish({ status: 'aborted' });
        } else if (error instanceof StreamDroppedError) {
          finish({
            status: 'error',
            error: { code: 'DROPPED', message: error.message, dropped: true },
          });
        } else if (isApiError(error) && error.retryAfterSec !== undefined) {
          // Nothing was saved; the caller puts the question back and counts down.
          if (frame.current !== null) cancelAnimationFrame(frame.current);
          controller.current = null;
          setTurn(idle);
          return { rateLimited: { retryAfter: error.retryAfterSec } };
        } else if (isApiError(error)) {
          finish({
            status: 'error',
            error: { code: error.code, message: error.message, retryAfter: error.retryAfterSec },
          });
        } else {
          finish({ status: 'error', error: { code: 'INTERNAL', message: 'Something went wrong' } });
        }
      } finally {
        invalidateConversation(client, workspaceId, conversationId);
      }
      return {};
    },
    [client, conversationId, workspaceId, finish, flush],
  );

  const stop = useCallback(() => controller.current?.abort(), []);
  const reset = useCallback(() => setTurn(idle), []);

  // Leaving the conversation stops its stream; the backend saves what was written.
  useEffect(
    () => () => {
      controller.current?.abort();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { turn, send, stop, reset };
}
