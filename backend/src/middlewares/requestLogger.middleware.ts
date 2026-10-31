import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import logger from '../config/logger.config.js';

// Load balancers poll these every few seconds.
const QUIET_PATHS = new Set(['/api/v1/health/live', '/api/v1/health/ready']);

// Inngest registers the app with a PUT, which its dev server repeats every few seconds, and
// one page load of the web app fetches dozens of files: below debug, as dev runs at debug.
// Inngest's POSTs run job steps and stay at info.
const isRoutine = (method: string, path: string | undefined) =>
  (method === 'PUT' && path === '/api/inngest') || path?.startsWith('/assets/') === true;

/** One log line per request once the response is sent. Query strings are left out on purpose. */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
  if (QUIET_PATHS.has(req.path)) return next();

  // Read now: inside a mounted router req.url has lost its prefix by the time the response ends.
  const path = req.originalUrl.split('?')[0];
  const start = process.hrtime.bigint();
  // 'close' fires for completed and aborted responses alike ('finish' only for completed ones).
  // Bound to the current context: on an abort it fires from the socket, outside the request's
  // AsyncLocalStorage scope, and the line would lose its correlation id.
  res.on(
    'close',
    AsyncLocalStorage.bind(() => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      // An event stream normally ends with the client leaving; that isn't worth a warning.
      const isStream = String(res.getHeader('content-type')).startsWith('text/event-stream');
      if (!res.writableFinished && !isStream) {
        // A page reload or navigation cancels its reads; a cut-off write is worth a look.
        const level = req.method === 'GET' || req.method === 'HEAD' ? 'debug' : 'warn';
        logger.log(level, `${req.method} ${path} aborted by client`, { durationMs });
        return;
      }
      const level =
        res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : isRoutine(req.method, path)
              ? 'silly'
              : 'info';
      logger.log(level, `${req.method} ${path} ${res.statusCode}`, { durationMs });
    }),
  );
  next();
}
