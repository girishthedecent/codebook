import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { asyncLocalStorage } from '../utils/helpers/request.helpers.js';

// Accept ids from a proxy or client, but only short, plain ones that are safe to log.
const VALID_ID = /^[\w-]{1,64}$/;

export function attachCorrelationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();

  res.setHeader('x-correlation-id', correlationId);

  asyncLocalStorage.run({ correlationId }, () => next());
}
