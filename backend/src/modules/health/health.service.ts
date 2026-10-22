import { appConfig } from '../../config/app.config.js';
import logger from '../../config/logger.config.js';
import { pingDatabase } from './health.repository.js';

/** Liveness: the process is up and serving. Never touches dependencies. */
export function getLivenessService() {
  return {
    status: 'ok' as const,
    version: appConfig.version,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/** Readiness: dependencies are reachable, so it is safe to send traffic here. */
export async function getReadinessService() {
  let db: 'ok' | 'down' = 'ok';
  try {
    await pingDatabase();
  } catch (error) {
    logger.warn('readiness check: database unreachable', { error });
    db = 'down';
  }

  return {
    status: db === 'ok' ? ('ok' as const) : ('degraded' as const),
    db,
    version: appConfig.version,
  };
}
