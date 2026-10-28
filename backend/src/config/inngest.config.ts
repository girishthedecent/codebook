import { Inngest } from 'inngest';
import { serverConfig } from './index.js';
import logger from './logger.config.js';

// The SDK logs every registration (every few seconds against the dev server) at debug; one
// level lower keeps that out of debug logs. Its info, warnings and errors stay as they are.
// `child` keeps the run id and event name the SDK attaches to a function's log lines.
type WinstonLogger = typeof logger;
function quietDebug(target: WinstonLogger) {
  return {
    info: target.info.bind(target),
    warn: target.warn.bind(target),
    error: target.error.bind(target),
    debug: target.silly.bind(target),
    child: (meta: Record<string, unknown>) => quietDebug(target.child(meta)),
  };
}
const sdkLogger = quietDebug(logger);

// Dev mode talks to the local dev server (INNGEST_BASE_URL) without keys. In production the
// event key sends events and the signing key verifies that calls to /api/inngest are real.
export const inngest = new Inngest({
  id: 'codebook',
  isDev: serverConfig.INNGEST_DEV,
  baseUrl: serverConfig.INNGEST_BASE_URL,
  eventKey: serverConfig.INNGEST_EVENT_KEY,
  signingKey: serverConfig.INNGEST_SIGNING_KEY,
  logger: sdkLogger,
});
