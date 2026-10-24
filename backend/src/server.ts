import { createServer } from 'node:http';
import { createApp } from './app.js';
import { appConfig } from './config/app.config.js';
import { serverConfig } from './config/index.js';
import logger from './config/logger.config.js';
import { warmUpReranker } from './llm/reranker.js';
import { drainRegistry, shutdownRegistry } from './utils/helpers/shutdown.helpers.js';
import { bucketReachable } from './utils/storage.js';

// Not app.listen(): in Express 5 its callback also runs on errors like EADDRINUSE.
const server = createServer(createApp());

server.on('listening', () => {
  logger.info(`Server is running on http://localhost:${serverConfig.PORT}`);
  // A missing bucket or stopped MinIO shows up now instead of on the first upload.
  void bucketReachable().then((ok) => {
    if (!ok) logger.warn('Storage bucket is not reachable; uploads will fail');
  });
  // Loading the model takes seconds (minutes on the first download); searches before it is
  // ready wait for the same load. Without reranking by default it loads on first use.
  if (serverConfig.NODE_ENV !== 'test' && appConfig.retrieval.rerankByDefault) {
    void warmUpReranker();
  }
});
server.on('error', (err) => {
  logger.error('Server failed to start', { error: err });
  process.exit(1);
});

server.listen(serverConfig.PORT);

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);

  // Don't hang forever on a stuck keep-alive connection.
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  server.close(async () => {
    const ok = await shutdownRegistry.run();
    process.exit(ok ? 0 : 1);
  });
  // After close(): no new connections, and streams opened from here on close at once.
  void drainRegistry.run();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// After one of these the process state can't be trusted, so log it and exit.
// The short delay lets winston flush the line to the log file first.
function crash(message: string, error: unknown) {
  logger.error(message, { error });
  setTimeout(() => process.exit(1), 200);
}

process.on('unhandledRejection', (reason) => crash('Unhandled promise rejection', reason));
process.on('uncaughtException', (error) => crash('Uncaught exception', error));
