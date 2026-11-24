import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from './config.js';

export const REDACTED = '[REDACTED]';

/**
 * Header paths removed from pino-http request/response logs. Request bodies
 * are never logged by pino-http.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

/**
 * Field names redacted at any depth in the object passed to a log call
 * (compared case-insensitively). Child logger bindings are not covered:
 * never bind secrets with logger.child().
 */
export const SECRET_KEYS: readonly string[] = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'cookie',
  'authorization',
];

const SECRET_KEY_SET = new Set(SECRET_KEYS.map((key) => key.toLowerCase()));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns a copy with secret fields replaced, whatever their nesting depth.
 * Only plain objects and arrays are traversed: other instances (errors,
 * IncomingMessage...) are left to pino serializers and REDACT_PATHS.
 */
function redactSecrets(value: unknown, ancestors: WeakSet<object>): unknown {
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  // Never hand back the original of a cycle: it still holds the secrets.
  if (ancestors.has(value)) return '[Circular]';
  ancestors.add(value);
  let copy: unknown;
  if (Array.isArray(value)) {
    copy = value.map((item) => redactSecrets(item, ancestors));
  } else {
    const entries: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      entries[key] = SECRET_KEY_SET.has(key.toLowerCase()) ? REDACTED : redactSecrets(child, ancestors);
    }
    copy = entries;
  }
  ancestors.delete(value);
  return copy;
}

function redactLogObject(object: Record<string, unknown>): Record<string, unknown> {
  return redactSecrets(object, new WeakSet()) as Record<string, unknown>;
}

export function createLogger(config: Pick<Config, 'LOG_LEVEL'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.LOG_LEVEL,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      formatters: { log: redactLogObject },
    },
    destination,
  );
}
