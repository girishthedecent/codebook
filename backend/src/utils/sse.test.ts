import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { drainRegistry } from './helpers/shutdown.helpers.js';
import { openSse, type SseStream } from './sse.js';

// A real server and socket: the cases here are about when the connection closes.
async function withServer(handler: express.RequestHandler, run: (port: number) => Promise<void>) {
  const app = express();
  app.get('/stream', handler);
  const server = app.listen(0);
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
}

describe('openSse', () => {
  it('stays open for a connected client and sends events', async () => {
    let stream!: SseStream;
    await withServer(
      (req, res) => {
        stream = openSse(req, res);
        stream.send('progress', { n: 1 });
        stream.close();
      },
      (port) =>
        new Promise<void>((resolve) => {
          httpRequest({ port, path: '/stream' }, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () => {
              expect(res.headers['content-type']).toMatch(/text\/event-stream/);
              expect(body).toBe('event: progress\ndata: {"n":1}\n\n');
              resolve();
            });
          }).end();
        }),
    );
    expect(stream.closed).toBe(true);
  });

  it('closes at once when the client left before the stream opened', async () => {
    let stream: SseStream | undefined;
    let opened!: () => void;
    const done = new Promise<void>((resolve) => (opened = resolve));

    await withServer(
      (req, res) => {
        // Stands in for the access check that runs before the stream opens: by the time
        // openSse runs, the request's 'close' event has already been emitted.
        req.once('close', () =>
          setImmediate(() => {
            stream = openSse(req, res);
            opened();
          }),
        );
      },
      async (port) => {
        const req = httpRequest({ port, path: '/stream' });
        req.on('error', () => {});
        req.end();
        await new Promise((resolve) => setTimeout(resolve, 100));
        req.destroy();
        await done;
      },
    );
    expect(stream?.closed).toBe(true);
    // A close handler added afterwards still runs, so slots taken for the stream are released.
    let ran = false;
    stream!.onClose(() => (ran = true));
    expect(ran).toBe(true);
  });

  // Last in the file: once drained, every stream in this process closes at once.
  it('closes streams that open after shutdown started', async () => {
    await drainRegistry.run();
    let stream!: SseStream;
    await withServer(
      (req, res) => {
        stream = openSse(req, res);
      },
      (port) =>
        new Promise<void>((resolve) => {
          httpRequest({ port, path: '/stream' }, (res) => {
            res.resume();
            res.on('end', () => resolve());
          }).end();
        }),
    );
    expect(stream.closed).toBe(true);
  });
});
