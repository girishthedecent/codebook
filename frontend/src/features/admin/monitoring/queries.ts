import { api, unwrap } from '@/api/client';
import type { RangeDays } from './ranges';

const DAY = 24 * 60 * 60 * 1000;

export type Window = { days: RangeDays; system: boolean };

// Keyed by the range and the system switch, not by timestamps: the window is "the last N days"
// as of each fetch.
function lastDays(days: RangeDays) {
  const to = new Date();
  return { from: new Date(to.getTime() - days * DAY).toISOString(), to: to.toISOString() };
}

const flag = (system: boolean) => (system ? 'true' : undefined);

export const statsQuery = ({ days, system }: Window) => ({
  queryKey: ['monitoring', 'stats', 'last', days, system] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    unwrap(
      api.GET('/api/v1/monitoring/stats', {
        params: { query: { ...lastDays(days), includeSystem: flag(system) } },
        signal,
      }),
    ),
  staleTime: 60_000,
});

export const modelsQuery = ({ days, system }: Window) => ({
  queryKey: ['monitoring', 'models', 'last', days, system] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    unwrap(
      api.GET('/api/v1/monitoring/models', {
        params: { query: { ...lastDays(days), includeSystem: flag(system) } },
        signal,
      }),
    ),
  staleTime: 60_000,
});

export const rateLimitsQuery = ({ days }: Pick<Window, 'days'>) => ({
  queryKey: ['monitoring', 'rate-limits', 'last', days] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    unwrap(
      api.GET('/api/v1/monitoring/rate-limits', { params: { query: lastDays(days) }, signal }),
    ),
  staleTime: 60_000,
});

export const ingestionFailuresQuery = ({ system }: Pick<Window, 'system'>) => ({
  queryKey: ['monitoring', 'ingestion-failures', system] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    unwrap(
      api.GET('/api/v1/monitoring/ingestion-failures', {
        params: { query: { limit: 20, includeSystem: flag(system) } },
        signal,
      }),
    ),
  staleTime: 60_000,
});

/** Live state of this server process, so it is re-read every half minute. */
export const circuitBreakerQuery = {
  queryKey: ['monitoring', 'circuit-breaker'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    unwrap(api.GET('/api/v1/monitoring/circuit-breaker', { signal })),
  refetchInterval: 30_000,
};
