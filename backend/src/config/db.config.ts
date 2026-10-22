import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { serverConfig } from './index.js';
import logger from './logger.config.js';

// Without this, opening a connection to an unreachable database waits for the OS TCP timeout.
const adapter = new PrismaPg({
  connectionString: serverConfig.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
});

const prismaClient = new PrismaClient({
  adapter,
  log: [
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'query' },
  ],
});

prismaClient.$on('warn', (e) => logger.warn(e.message, { target: e.target }));
prismaClient.$on('error', (e) => logger.error(e.message, { target: e.target }));

// Query logs are noisy and include raw parameters, so they only show up with
// LOG_LEVEL=silly, which is for local debugging only.
if (logger.isSillyEnabled()) {
  prismaClient.$on('query', (e) =>
    logger.silly(e.query, { durationMs: e.duration, params: e.params }),
  );
}

export default prismaClient;
