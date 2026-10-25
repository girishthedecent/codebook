import { isAPIError } from 'better-auth/api';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import logger from '../config/logger.config.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  AppError,
  BadRequestError,
  type ErrorCode,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PayloadTooLargeError,
} from '../utils/errors/app.error.js';
import { getCorrelationId } from '../utils/helpers/request.helpers.js';

// body-parser's own error types. Matched by name because SDK errors (e.g. OpenAI-style
// provider errors) also carry `status` and `type`, and those must stay server errors.
const BODY_PARSER_ERRORS = new Set([
  'entity.too.large',
  'entity.parse.failed',
  'entity.verify.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'request.aborted',
  'request.size.invalid',
  'stream.encoding.set',
  'stream.not.readable',
  'parameters.too.many',
]);

const AUTH_ERROR_CODES: Record<number, ErrorCode> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

function isBodyParserError(err: unknown): err is { type: string } {
  const type = (err as { type?: unknown } | null)?.type;
  return typeof type === 'string' && BODY_PARSER_ERRORS.has(type);
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new BadRequestError('Invalid request', issues);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return new NotFoundError();
    if (err.code === 'P2002') return new ConflictError('Resource already exists');
  }

  // Thrown by better-auth when a service calls auth.api.* (its own routes answer for
  // themselves). Its 4xx messages are written for users; anything else stays a 500.
  if (isAPIError(err) && err.statusCode >= 400 && err.statusCode < 500) {
    const message = (err.body as { message?: unknown } | undefined)?.message;
    return new AppError(
      typeof message === 'string' && message ? message : 'Request failed',
      err.statusCode,
      AUTH_ERROR_CODES[err.statusCode] ?? 'VALIDATION_ERROR',
    );
  }

  if (isBodyParserError(err)) {
    if (err.type === 'entity.too.large') return new PayloadTooLargeError('Request body too large');
    if (err.type === 'entity.parse.failed') return new BadRequestError('Malformed JSON body');
    return new BadRequestError('Malformed request body');
  }

  // The router throws this for a path param with broken %-encoding.
  if (err instanceof URIError) return new BadRequestError('Malformed URL');

  return new InternalServerError();
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
}

export function genericErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  // Once a response has started (e.g. an SSE stream) Express has to close the connection itself.
  // Log it here first: Express's own fallback prints to stderr without the correlation id.
  if (res.headersSent) {
    logger.error('error after response started', {
      error: err,
      method: req.method,
      path: req.path,
    });
    return next(err);
  }

  const appError = toAppError(err);

  if (appError.statusCode >= 500) {
    // The original error (with stack) is only logged, never sent to the client.
    logger.error(err instanceof Error ? err.message : 'Unhandled error', {
      error: err,
      method: req.method,
      path: req.path,
    });
  }

  const retryAfter = (appError.details as { retryAfterSeconds?: unknown } | undefined)
    ?.retryAfterSeconds;
  if (appError.statusCode === 429 && typeof retryAfter === 'number') {
    res.set('Retry-After', String(retryAfter));
  }

  res.status(appError.statusCode).json({
    success: false,
    message: appError.message,
    code: appError.code,
    ...(appError.details !== undefined && { details: appError.details }),
    correlationId: getCorrelationId(),
  });
}
