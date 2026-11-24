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
 */
export function cors(allowedOrigins: readonly string[]): RequestHandler {
  const allowlist = new Set(allowedOrigins);
  return corsMiddleware({
    origin: (origin, callback) => {
      if (origin === undefined) {
        callback(null, false);
      } else if (allowlist.has(origin)) {
        callback(null, origin);
      } else {
        callback(new AppError(403, 'CORS_FORBIDDEN', 'This origin is not allowed.'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', CORRELATION_HEADER],
    exposedHeaders: [CORRELATION_HEADER],
    maxAge: 600,
  });
}
