import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getCorrelationId } from '../utils/helpers/request.helpers.js';
import { serverConfig } from './index.js';

const writeFiles = serverConfig.LOG_TO_FILE && serverConfig.NODE_ENV !== 'test';

// Error objects stringify to {} by default, which would hide the actual failure.
function serializeErrors(_key: string, value: unknown) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

const logger = winston.createLogger({
  level: serverConfig.LOG_LEVEL === 'silent' ? 'error' : serverConfig.LOG_LEVEL,
  silent: serverConfig.LOG_LEVEL === 'silent',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    // ISO 8601 in UTC, same as the timestamps stored in the database.
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp, stack, ...data }) =>
      JSON.stringify(
        {
          timestamp,
          level,
          message,
          correlationId: getCorrelationId(),
          ...(stack ? { stack } : {}),
          ...(Object.keys(data).length > 0 ? { data } : {}),
        },
        serializeErrors,
      ),
    ),
  ),
  transports: [
    new winston.transports.Console(),
    ...(writeFiles
      ? [
          new DailyRotateFile({
            filename: 'logs/%DATE%-app.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
          }),
        ]
      : []),
  ],
});

export default logger;
