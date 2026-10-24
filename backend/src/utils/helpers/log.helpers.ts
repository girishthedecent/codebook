import logger from '../../config/logger.config.js';

// The fields every structured event carries, so logs can be filtered the same way across
// modules. The logger adds the request's correlationId itself.
export type LogFields = {
  userId?: string;
  workspaceId?: string;
  durationMs?: number;
  [field: string]: unknown;
};

type Level = 'error' | 'warn' | 'info' | 'debug';

/** One named event from a module, e.g. logEvent('chat', 'step.done', { durationMs }). */
export function logEvent(
  module: string,
  event: string,
  fields: LogFields = {},
  level: Level = 'info',
) {
  logger.log(level, event, { module, event, ...fields });
}
