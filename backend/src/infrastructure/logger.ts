import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from './config.js';

export const REDACTED = '[REDACTED]';

/**
 * Paths removed from every log line. Request bodies are never logged by
 * pino-http; the field paths below protect explicit log calls as well.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'refreshToken',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.*.password',
  '*.*.token',
  '*.*.refreshToken',
];

export function createLogger(config: Pick<Config, 'LOG_LEVEL'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.LOG_LEVEL,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: REDACTED },
    },
    destination,
  );
}
