import corsMiddleware from 'cors';
import type { RequestHandler } from 'express';
import { AppError } from './errors.js';
import { CORRELATION_HEADER } from './correlationId.js';

/**
 * CORS policy (explicit allowlist, no wildcard):
 * - No Origin header (curl, server-to-server, native mobile app): passed through
 *   without CORS headers. CORS is not an authentication mechanism.
 * - Origin in the allowlist: CORS headers echo that exact origin, credentials allowed.
 * - Any other Origin: rejected with 403 CORS_FORBIDDEN and no CORS headers.
 * Every response carries `Vary: Origin`, including those without an Origin
 * header, so a shared cache never serves a no-CORS copy (e.g. the cached
 * categories list) to a browser origin, or the reverse.
 */
export function cors(allowedOrigins: readonly string[]): RequestHandler {
  const allowlist = new Set(allowedOrigins);
  const inner = corsMiddleware({
    origin: (origin, callback) => {
      if (origin === undefined) {
        callback(null, false);
      } else if (allowlist.has(origin)) {
        callback(null, origin);
      } else {
        callback(new AppError('CORS_FORBIDDEN'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', CORRELATION_HEADER],
    // Retry-After lets browser clients (and Expo Web) read the 429 back-off.
    exposedHeaders: [CORRELATION_HEADER, 'Retry-After'],
    maxAge: 600,
  });
  return (req, res, next) => {
    res.vary('Origin');
    inner(req, res, next);
  };
}
