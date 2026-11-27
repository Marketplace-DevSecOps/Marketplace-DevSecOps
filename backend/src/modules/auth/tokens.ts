import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { Config } from '../../infrastructure/config.js';

/** Access token lifetime: 10 minutes (spec 3.3). */
export const ACCESS_TOKEN_TTL_SECONDS = 600;
/** Refresh family lifetime: 7 days from login; rotated tokens inherit the expiry. */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 32;

// The only accepted algorithm: one process signs and verifies, so a shared
// HMAC key is enough. "none" and asymmetric algorithms are never accepted.
const ALGORITHM = 'HS256';

export type AccessTokenConfig = Pick<Config, 'JWT_ACCESS_SECRET' | 'JWT_ISSUER' | 'JWT_AUDIENCE'>;

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface AccessTokenService {
  sign(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }>;
  /** Throws InvalidTokenError on any failure (signature, alg, iss, aud, exp, claims). */
  verify(token: string): Promise<AccessTokenClaims>;
}

/** Deliberately carries no reason: callers answer 401 without details. */
export class InvalidTokenError extends Error {
  constructor() {
    super('Invalid access token');
    this.name = 'InvalidTokenError';
  }
}

/**
 * Access JWT: header {alg: HS256, typ: JWT}; claims sub (user id), sid
 * (session id), iss, aud, iat, exp. The role is never in the token: it is read
 * from the database with the session on each request.
 */
export function createAccessTokenService(config: AccessTokenConfig, now: () => Date = () => new Date()): AccessTokenService {
  const key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  return {
    async sign({ userId, sessionId }) {
      const issuedAt = Math.floor(now().getTime() / 1000);
      const expiresAt = issuedAt + ACCESS_TOKEN_TTL_SECONDS;
      const token = await new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(config.JWT_ISSUER)
        .setAudience(config.JWT_AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(key);
      return { token, expiresAt: new Date(expiresAt * 1000) };
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: [ALGORITHM],
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          requiredClaims: ['sub', 'sid', 'iat', 'exp'],
          maxTokenAge: ACCESS_TOKEN_TTL_SECONDS,
          currentDate: now(),
        });
        const { sub, sid } = payload;
        if (typeof sub !== 'string' || typeof sid !== 'string') throw new InvalidTokenError();
        return { userId: sub, sessionId: sid };
      } catch {
        throw new InvalidTokenError();
      }
    },
  };
}

/** Opaque refresh token: 32 random bytes, base64url (43 characters). */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 hex digest stored in Session.refreshTokenHash. A fast hash is enough:
 * the token has 256 bits of entropy, so it cannot be guessed offline.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
