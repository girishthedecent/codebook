import { AsyncLocalStorage } from 'node:async_hooks';

type RequestStore = {
  correlationId: string;
};

export const asyncLocalStorage = new AsyncLocalStorage<RequestStore>();

/** The id of the request being handled, or undefined outside a request (startup, jobs). */
export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}
