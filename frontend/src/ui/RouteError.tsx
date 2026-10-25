import type { ErrorComponentProps } from '@tanstack/react-router';
import { isApiError } from '@/api/client';

export function RouteError({ error, reset }: ErrorComponentProps) {
  const api = isApiError(error) ? error : undefined;
  return (
    <main className="mx-auto max-w-[560px] px-4 py-24">
      <p className="font-mono text-xs text-ink-3">{api ? api.code : 'Error'}</p>
      <h1 className="mt-2 text-lg font-semibold">{api?.message ?? 'Something went wrong.'}</h1>
      {api?.correlationId && (
        <p className="mt-3 font-mono text-xs text-ink-3">reference {api.correlationId}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-sm border border-rule-2 px-3 py-1.5 text-sm hover:bg-paper-2"
      >
        Try again
      </button>
    </main>
  );
}
