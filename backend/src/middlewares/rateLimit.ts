import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { normalizeLoginEmail } from '../modules/auth/auth.schemas.js';
import { AppError } from './errors.js';

export const LOGIN_WINDOW_MS = 60_000;
/** Failed logins per minute for one (normalized email, IP) pair. */
export const LOGIN_FAILURES_PER_ACCOUNT_IP = 5;
/** Failed logins per minute for one IP, whatever the email (password spraying). */
export const LOGIN_FAILURES_PER_IP = 20;

export interface LoginLimiters {
  /** Mounted on both /auth/login and /auth/mobile/login, so the quota is shared. */
  perIp: RequestHandler;
  perAccountIp: RequestHandler;
}

/**
 * Login quotas (express-rate-limit, default MemoryStore). Only failed attempts
 * count (status >= 400); a successful login gives its slot back. Limiters run
 * before body validation so malformed attempts count too.
 *
 * The MemoryStore is per process and resets on restart: a deployment with
 * several API instances needs a shared store (e.g. rate-limit-redis).
 * The email is hashed in the key so the store never holds addresses.
 */
export function createLoginLimiters(): LoginLimiters {
  const common = {
    windowMs: LOGIN_WINDOW_MS,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Retry-After is set by the library before the handler runs.
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED'));
    },
  } as const satisfies Parameters<typeof rateLimit>[0];
  return {
    perIp: rateLimit({
      ...common,
      limit: LOGIN_FAILURES_PER_IP,
      identifier: 'login-ip',
      // ipKeyGenerator groups an IPv6 /56, so one host cannot rotate addresses.
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    }),
    perAccountIp: rateLimit({
      ...common,
      limit: LOGIN_FAILURES_PER_ACCOUNT_IP,
      identifier: 'login-account-ip',
      keyGenerator: (req) => {
        const body: unknown = req.body;
        const email = normalizeLoginEmail(typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined);
        return `${createHash('sha256').update(email, 'utf8').digest('hex')}|${ipKeyGenerator(req.ip ?? 'unknown')}`;
      },
    }),
  };
}
