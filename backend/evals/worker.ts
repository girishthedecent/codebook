import { createServer } from 'node:http';
import express from 'express';
import { serve } from 'inngest/express';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { serverConfig } from '../src/config/index.js';
import logger from '../src/config/logger.config.js';
import { createRunEval, evalsInngest } from './runEval.function.js';
import { suites } from './suites.js';

// pnpm evals:worker — serves the eval app's Inngest functions on EVALS_WORKER_PORT. Runs are
// queued with POST /api/v1/evals/runs (admins) and run here, one at a time.

const app = express();
app.use(
  '/api/inngest',
  express.json({ limit: appConfig.inngest.bodyLimit }),
  serve({ client: evalsInngest, functions: [createRunEval(suites)] }),
);

// Not app.listen(): in Express 5 its callback also runs on errors like EADDRINUSE.
const server = createServer(app);
server.on('listening', () => {
  logger.info(`Eval worker is running on http://localhost:${serverConfig.EVALS_WORKER_PORT}`);
});
server.on('error', (error) => {
  logger.error('Eval worker failed to start', { error });
  process.exit(1);
});
server.listen(serverConfig.EVALS_WORKER_PORT);

function shutdown(signal: string) {
  logger.info(`${signal} received, stopping the eval worker`);
  // A case in flight is retried by Inngest when the worker comes back.
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(() => {
    void prismaClient.$disconnect().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
