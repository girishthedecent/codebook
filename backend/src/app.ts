import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { appConfig } from './config/app.config.js';
import { serverConfig } from './config/index.js';
import { attachCorrelationIdMiddleware } from './middlewares/correlation.middleware.js';
import { genericErrorHandler, notFoundHandler } from './middlewares/error.middleware.js';
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

  app.use(express.json({ limit: appConfig.http.jsonLimit }));
  app.use('/api/v1', v1Router);

  app.use(notFoundHandler);
  app.use(genericErrorHandler);

  return app;
}
