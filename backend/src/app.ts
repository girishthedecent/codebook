import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { serve } from 'inngest/express';
import { appConfig } from './config/app.config.js';
import { serverConfig } from './config/index.js';
import { inngest } from './config/inngest.config.js';
import { functions } from './inngest/functions.js';
import { authHandler, readAuthBody } from './middlewares/authHandler.middleware.js';
import { attachClientIpMiddleware } from './middlewares/clientIp.middleware.js';
import { attachCorrelationIdMiddleware } from './middlewares/correlation.middleware.js';
import { genericErrorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { requireTrustedOrigin } from './middlewares/origin.middleware.js';
import { requestLoggerMiddleware } from './middlewares/requestLogger.middleware.js';
import v1Router from './routers/v1/index.router.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', serverConfig.TRUST_PROXY);

  // First, so every response (CORS preflights included) gets an id and a log line.
  app.use(attachCorrelationIdMiddleware);
  app.use(requestLoggerMiddleware);

  app.use(helmet());
  app.use(
    cors({
      origin: serverConfig.TRUSTED_ORIGINS,
      credentials: true,
      exposedHeaders: ['x-correlation-id'],
    }),
  );
  app.use(attachClientIpMiddleware);

  // Before express.json(): better-auth gets the body as text, not parsed JSON.
  app.all('/api/auth/*splat', readAuthBody, authHandler);

  // Called by the Inngest server, not browsers; requests are signed in production. Its own
  // JSON parser, because step state can be bigger than the API's limit.
  app.use(
    '/api/inngest',
    express.json({ limit: appConfig.inngest.bodyLimit }),
    serve({ client: inngest, functions }),
  );

  app.use(express.json({ limit: appConfig.http.jsonLimit }));
  app.use('/api/v1', requireTrustedOrigin, v1Router);

  app.use(notFoundHandler);
  app.use(genericErrorHandler);

  return app;
}
