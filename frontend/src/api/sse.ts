import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { ApiError, type ErrorBody } from './client';
import type { SendMessageBody, SourceEvent, TurnEvent } from './types';

/** The connection ended before the server sent its last event. */
export class StreamDroppedError extends Error {
  constructor(message = 'The connection dropped before the stream finished') {
    super(message);
    this.name = 'StreamDroppedError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortError() {
  return new DOMException('The stream was aborted', 'AbortError');
}

export type SseMessage = { event: string; data: string };

/**
 * Opens a server-sent-events response with `fetch` (EventSource can't POST or send a body)
 * and yields each message as it arrives. Chunk boundaries fall anywhere, so the bytes go
 * through eventsource-parser, which also joins multi-line `data:` fields.
 *
 * Non-2xx replies throw an ApiError built from the JSON error body. A connection that ends
 * mid-stream rejects with StreamDroppedError; an aborted signal with an AbortError.
 */
export async function* streamEvents(
  url: string,
  init: RequestInit = {},
  { signal }: { signal?: AbortSignal } = {},
): AsyncGenerator<SseMessage, void, undefined> {
  if (signal?.aborted) throw abortError();

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...init,
      signal,
      headers: { Accept: 'text/event-stream', ...(init.headers ?? {}) },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, undefined);
  }

  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    const body = (await response.json().catch(() => undefined)) as ErrorBody | undefined;
    throw new ApiError(response.status, body, retry ? Number(retry) || undefined : undefined);
  }
  if (!response.body) throw new StreamDroppedError();

  const pending: SseMessage[] = [];
  const parser = createParser({
    onEvent(message: EventSourceMessage) {
      pending.push({ event: message.event ?? 'message', data: message.data });
    },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw abortError();
        throw new StreamDroppedError();
      }
      if (signal?.aborted) throw abortError();
      if (chunk.done) break;
      parser.feed(decoder.decode(chunk.value, { stream: true }));
      while (pending.length) yield pending.shift()!;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

const turnEvents = new Set(['step', 'token', 'citations', 'done', 'error']);
const sourceEvents = new Set(['progress', 'done', 'failed', 'deleted', 'error']);

/**
 * One chat turn. Yields `step` and `token` events while the agent works, then `citations`
 * and `done`, or `error`. A cached answer skips the steps, so nothing should wait for one.
 * Ends with StreamDroppedError if the server went away before `done` or `error`.
 */
export async function* streamTurn(
  conversationId: string,
  body: SendMessageBody,
  signal?: AbortSignal,
): AsyncGenerator<TurnEvent, void, undefined> {
  let finished = false;
  const url = `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  for await (const message of streamEvents(url, init, { signal })) {
    if (!turnEvents.has(message.event)) continue;
    const event = { event: message.event, data: JSON.parse(message.data) } as TurnEvent;
    if (event.event === 'done' || event.event === 'error') finished = true;
    yield event;
  }
  if (!finished) throw new StreamDroppedError('The answer stopped before it finished');
}

/**
 * Ingestion progress for one source: the current state first, then every change, then
 * `done` or `failed` (or `deleted`). Open it only while the source is still being indexed.
 */
export async function* streamSourceProgress(
  sourceId: string,
  signal?: AbortSignal,
): AsyncGenerator<SourceEvent, void, undefined> {
  let finished = false;
  const url = `/api/v1/sources/${encodeURIComponent(sourceId)}/events`;
  for await (const message of streamEvents(url, {}, { signal })) {
    if (!sourceEvents.has(message.event)) continue;
    const event = { event: message.event, data: JSON.parse(message.data) } as SourceEvent;
    if (event.event !== 'progress') finished = true;
    yield event;
  }
  if (!finished) throw new StreamDroppedError('Lost the progress stream');
}
