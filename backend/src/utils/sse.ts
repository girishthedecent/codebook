import type { Request, Response } from 'express';
import { appConfig } from '../config/app.config.js';
import { drainRegistry } from './helpers/shutdown.helpers.js';

export type SseStream = {
  send(event: string, data: unknown): void;
  close(): void;
  readonly closed: boolean;
  /** Runs once, when either side closes the stream. */
  onClose(fn: () => void): void;
};

const openStreams = new Set<SseStream>();

drainRegistry.register(async () => {
  for (const stream of openStreams) stream.close();
});

/** Turns the response into a Server-Sent Events stream. */
export function openSse(req: Request, res: Response): SseStream {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops nginx-style proxies from buffering the stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let closed = false;
  const closeHandlers: (() => void)[] = [];

  // A comment line every so often keeps proxies from timing out a quiet stream.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), appConfig.sse.heartbeatMs);

  const stream: SseStream = {
    send(event, data) {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      openStreams.delete(stream);
      res.end();
      for (const fn of closeHandlers) fn();
    },
    get closed() {
      return closed;
    },
    onClose(fn) {
      closeHandlers.push(fn);
    },
  };

  openStreams.add(stream);
  // The client went away. If it left before we got here (while access was checked), 'close'
  // has already fired, so check now too or the stream would poll for nobody.
  req.on('close', () => stream.close());
  if (!res.socket || res.socket.destroyed) stream.close();
  return stream;
}
