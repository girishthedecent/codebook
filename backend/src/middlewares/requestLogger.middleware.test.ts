import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import logger from '../config/logger.config.js';
import { getCorrelationId } from '../utils/helpers/request.helpers.js';
import { attachCorrelationIdMiddleware } from './correlation.middleware.js';
import { requestLoggerMiddleware } from './requestLogger.middleware.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestLoggerMiddleware', () => {
  it('logs the full path (without query) for routes inside a mounted router', async () => {
    const log = vi.spyOn(logger, 'log');
    const router = express.Router();
    router.get('/items/:id', (_req, res) => {
      res.json({});
    });
    const app = express();
    app.use(requestLoggerMiddleware);
    app.use('/api/v1', router);

    await request(app).get('/api/v1/items/42?token=secret');

    expect(log).toHaveBeenCalledWith('info', 'GET /api/v1/items/42 200', expect.any(Object));
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });

  it('logs client errors as warn and server errors as error', async () => {
    const log = vi.spyOn(logger, 'log');
    const app = express();
    app.use(requestLoggerMiddleware);
    app.get('/missing', (_req, res) => {
      res.status(404).json({});
    });
    app.get('/broken', (_req, res) => {
      res.status(500).json({});
    });

    await request(app).get('/missing');
    await request(app).get('/broken');
    expect(log).toHaveBeenCalledWith('warn', 'GET /missing 404', expect.any(Object));
    expect(log).toHaveBeenCalledWith('error', 'GET /broken 500', expect.any(Object));
  });

  it('logs an aborted read at debug, with its correlation id', async () => {
    const seen: (string | undefined)[] = [];
    vi.spyOn(logger, 'log').mockImplementation(((level: string, message: string) => {
      if (message.endsWith('aborted by client')) seen.push(`${level} ${getCorrelationId()}`);
      return logger;
    }) as typeof logger.log);

    let reached!: () => void;
    const handlerReached = new Promise<void>((resolve) => (reached = resolve));
    const app = express();
    app.use(attachCorrelationIdMiddleware);
    app.use(requestLoggerMiddleware);
    app.get('/slow', () => reached()); // never responds

    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      const closed = new Promise<void>((resolve) =>
        server.once('connection', (s) => s.once('close', () => resolve())),
      );
      const req = httpRequest({ port, path: '/slow', headers: { 'x-correlation-id': 'abort-1' } });
      req.on('error', () => {});
      req.end();
      await handlerReached;
      req.destroy();
      await closed;
      await new Promise((resolve) => setImmediate(resolve));

      expect(seen).toEqual(['debug abort-1']);
    } finally {
      server.close();
    }
  });

  it('logs an event stream the client closed as a normal request', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const log = vi.spyOn(logger, 'log');

    let reached!: () => void;
    const handlerReached = new Promise<void>((resolve) => (reached = resolve));
    const app = express();
    app.use(requestLoggerMiddleware);
    app.get('/stream', (_req, res) => {
      res.set('Content-Type', 'text/event-stream').flushHeaders();
      reached(); // never ends: the client leaves
    });

    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      const closed = new Promise<void>((resolve) =>
        server.once('connection', (s) => s.once('close', () => resolve())),
      );
      const req = httpRequest({ port, path: '/stream' });
      req.on('error', () => {});
      req.end();
      await handlerReached;
      req.destroy();
      await closed;
      await new Promise((resolve) => setImmediate(resolve));

      expect(warn).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('info', 'GET /stream 200', expect.any(Object));
    } finally {
      server.close();
    }
  });

  it("logs Inngest's registration PUTs below debug and its step POSTs at info", async () => {
    const log = vi.spyOn(logger, 'log');
    const app = express();
    app.use(requestLoggerMiddleware);
    app.all('/api/inngest', (_req, res) => {
      res.json({});
    });

    await request(app).put('/api/inngest');
    await request(app).post('/api/inngest');
    expect(log).toHaveBeenCalledWith('silly', 'PUT /api/inngest 200', expect.any(Object));
    expect(log).toHaveBeenCalledWith('info', 'POST /api/inngest 200', expect.any(Object));
  });

  it("logs the web app's files below info, so a page load stays one quiet burst", async () => {
    const log = vi.spyOn(logger, 'log');
    const app = express();
    app.use(requestLoggerMiddleware);
    app.get('/assets/app-1a2b3c.js', (_req, res) => {
      res.type('js').send('1');
    });

    await request(app).get('/assets/app-1a2b3c.js');
    expect(log).toHaveBeenCalledWith('silly', 'GET /assets/app-1a2b3c.js 200', expect.any(Object));
  });

  it('skips health checks', async () => {
    const log = vi.spyOn(logger, 'log');
    const app = express();
    app.use(requestLoggerMiddleware);
    app.get('/api/v1/health/live', (_req, res) => {
      res.json({});
    });

    await request(app).get('/api/v1/health/live');
    expect(log).not.toHaveBeenCalled();
  });
});
