export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'GUEST_LIMIT'
  | 'HOURLY_LIMIT'
  | 'DAILY_LIMIT'
  | 'TOKEN_BUDGET'
  | 'UPSTREAM_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: ErrorCode,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in required') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not allowed') {
    super(message, 403, 'FORBIDDEN');
  }
}

// Also used when a record exists but belongs to someone else, so ids can't be probed.
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large') {
    super(message, 413, 'PAYLOAD_TOO_LARGE');
  }
}

// The limits a client tells apart: a visitor, an hour, a day, the token budget. Any other is
// plain RATE_LIMITED.
export type RateLimitCode = Extract<
  ErrorCode,
  'RATE_LIMITED' | 'GUEST_LIMIT' | 'HOURLY_LIMIT' | 'DAILY_LIMIT' | 'TOKEN_BUDGET'
>;

export class TooManyRequestsError extends AppError {
  constructor(
    // Seconds until the limit's window ends; sent as the Retry-After header and in the body.
    readonly retryAfterSec?: number,
    code: RateLimitCode = 'RATE_LIMITED',
    message = 'Too many requests',
  ) {
    super(message, 429, code);
  }
}

export class UpstreamError extends AppError {
  // `cause` is the provider's error, for callers that react to its kind; never sent out.
  constructor(service: string, details?: unknown, options?: ErrorOptions) {
    super(`${service} request failed`, 502, 'UPSTREAM_ERROR', details, options);
  }
}

export class NotImplementedError extends AppError {
  constructor(message = 'Not implemented') {
    super(message, 501, 'NOT_IMPLEMENTED');
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Something went wrong') {
    super(message, 500, 'INTERNAL');
  }
}
