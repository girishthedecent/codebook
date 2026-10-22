import { createServer } from 'node:http';
import { createApp } from './app.js';
import prismaClient from './config/db.config.js';
import { serverConfig } from './config/index.js';
import logger from './config/logger.config.js';

// Not app.listen(): in Express 5 its callback also runs on errors like EADDRINUSE.
const server = createServer(createApp());

server.on('listening', () =>
  logger.info(`Server is running on http://localhost:${serverConfig.PORT}`),
);
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

  server.close(() => {
    prismaClient.$disconnect().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error('Failed to disconnect from the database', { error: err });
        process.exit(1);
      },
    );
  });
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
