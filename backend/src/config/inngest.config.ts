import { Inngest } from 'inngest';
import { serverConfig } from './index.js';
import logger from './logger.config.js';

// Dev mode talks to the local dev server (INNGEST_BASE_URL) without keys. In production the
// event key sends events and the signing key verifies that calls to /api/inngest are real.
export const inngest = new Inngest({
  id: 'codebook',
  isDev: serverConfig.INNGEST_DEV,
  baseUrl: serverConfig.INNGEST_BASE_URL,
  eventKey: serverConfig.INNGEST_EVENT_KEY,
  signingKey: serverConfig.INNGEST_SIGNING_KEY,
  logger,
});
