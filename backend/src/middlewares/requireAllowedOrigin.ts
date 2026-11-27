import type { RequestHandler } from 'express';
import { AppError } from './errors.js';

/**
 * For cookie-based Web routes (login, refresh, logout): the request must come
 * from a browser page on an allowed origin. The CORS middleware already rejects
 * a foreign Origin (403 CORS_FORBIDDEN); this also rejects a missing Origin,
 * which CORS lets through for non-browser clients.
 */
export function requireAllowedOrigin(allowedOrigins: readonly string[]): RequestHandler {
  const allowlist = new Set(allowedOrigins);
  return (req, _res, next) => {
    const origin = req.get('Origin');
    if (origin === undefined || !allowlist.has(origin)) {
      next(new AppError('FORBIDDEN'));
      return;
    }
    next();
  };
}
