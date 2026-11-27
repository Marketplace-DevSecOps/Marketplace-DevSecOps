import type { Request, RequestHandler } from 'express';
import type { Role } from '../generated/prisma/client.js';
import type { SessionsService } from '../modules/auth/sessions.service.js';
import type { AccessTokenService } from '../modules/auth/tokens.js';
import { AppError } from './errors.js';

/** Identity of the caller, built from a verified token and the database. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Read from the database on every request, never from the token. */
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireAuth on protected routes. */
    auth?: AuthContext;
  }
}

/** Upper bound on the Authorization header value we try to parse. */
const MAX_TOKEN_LENGTH = 4096;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

export interface RequireAuthDependencies {
  tokens: Pick<AccessTokenService, 'verify'>;
  sessions: Pick<SessionsService, 'findActiveSession'>;
}

/**
 * Protects a route: `Authorization: Bearer <access JWT>` must verify strictly
 * (tokens.ts) and its session must still be active in the database (not
 * revoked, not expired, owned by `sub`, user ACTIVE). Every failure is the same
 * neutral 401 UNAUTHORIZED, so the client learns nothing about the reason.
 */
export function createRequireAuth({ tokens, sessions }: RequireAuthDependencies): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('Authorization');
    const match = header !== undefined && header.length <= MAX_TOKEN_LENGTH ? BEARER.exec(header) : null;
    if (match?.[1] === undefined) {
      next(new AppError('UNAUTHORIZED'));
      return;
    }
    let claims;
    try {
      claims = await tokens.verify(match[1]);
    } catch {
      next(new AppError('UNAUTHORIZED'));
      return;
    }
    const session = await sessions.findActiveSession(claims.sessionId, claims.userId);
    if (session === null) {
      next(new AppError('UNAUTHORIZED'));
      return;
    }
    req.auth = { userId: session.userId, sessionId: claims.sessionId, role: session.role };
    next();
  };
}

/** The caller's identity on a route behind requireAuth. */
export function getAuth(req: Request): AuthContext {
  if (req.auth === undefined) {
    throw new Error('getAuth called on a route without the requireAuth middleware');
  }
  return req.auth;
}
