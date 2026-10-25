import createClient from 'openapi-fetch';
import type { paths } from './schema';

/**
 * One fetch client for the whole app. Relative base URL: in dev Vite proxies `/api` to the
 * backend, in production both sit behind one origin, so the auth cookie is always first-party.
 */
export const api = createClient<paths>({
  baseUrl: '/',
  credentials: 'include',
  headers: { Accept: 'application/json' },
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId?: string;
  readonly retryAfterSec?: number;

  constructor(status: number, body: ErrorBody | undefined, retryAfterSec?: number) {
    super(body?.message ?? defaultMessage(status));
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? (status === 0 ? 'NETWORK' : 'HTTP_' + status);
    this.correlationId = body?.correlationId;
    this.retryAfterSec = retryAfterSec;
  }
}

export type ErrorBody = {
  success: false;
  message: string;
  code: string;
  correlationId?: string;
};

function defaultMessage(status: number) {
  if (status === 0) return 'You seem to be offline';
  if (status === 401) return 'Please sign in';
  if (status === 404) return 'Not found';
  if (status === 429) return 'Too many requests';
  return 'Something went wrong';
}

/**
 * Every backend reply is `{ success, message, data }`; this unwraps `data` or throws ApiError.
 * A 204 has no body, so `data` is undefined and the result is `void`.
 */
export async function unwrap<T>(
  promise: Promise<{ data?: { data: T } | undefined; error?: unknown; response: Response }>,
): Promise<T> {
  let result: Awaited<typeof promise>;
  try {
    result = await promise;
  } catch {
    throw new ApiError(0, undefined);
  }
  const { data, error, response } = result;
  if (error !== undefined || !response.ok) {
    const retry = response.headers.get('Retry-After');
    throw new ApiError(
      response.status,
      error as ErrorBody | undefined,
      retry ? Number(retry) || undefined : undefined,
    );
  }
  return (data as { data: T } | undefined)?.data as T;
}

export function isApiError(e: unknown, status?: number): e is ApiError {
  return e instanceof ApiError && (status === undefined || e.status === status);
}
