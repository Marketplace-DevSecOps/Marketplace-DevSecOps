import { randomUUID } from 'node:crypto';
import type { Role } from '../../generated/prisma/client.js';
import { AppError } from '../../middlewares/errors.js';
import type { SessionRecord, SessionsRepository } from './sessions.repository.js';
import { generateRefreshToken, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from './tokens.js';

/**
 * A used refresh token presented again within this window is treated as a
 * concurrent duplicate (409, family kept); after it, as a reuse (family
 * revoked). See docs/backend/session-policy.md ("Concurrent refresh").
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IssuedSession {
  session: SessionRecord;
  /** Plaintext refresh token: returned to the client once, never stored. */
  refreshToken: string;
}

export interface SessionsService {
  /** Starts a new rotation family for a login. */
  createSession(userId: string): Promise<IssuedSession>;
  /**
   * Rotates a refresh token. Throws AppError('CONFLICT') for a concurrent
   * duplicate and AppError('UNAUTHORIZED') for anything else that fails;
   * a reused or revoked token revokes its whole family first.
   */
  rotate(refreshToken: string): Promise<IssuedSession>;
  findByRefreshToken(refreshToken: string): Promise<SessionRecord | null>;
  /** Revokes every session of the family; returns the ids newly revoked. */
  revokeFamily(familyId: string): Promise<string[]>;
  /** Session check behind every protected request (role read from the DB). */
  findActiveSession(sessionId: string, userId: string): Promise<{ userId: string; role: Role } | null>;
}

export interface SessionsServiceOptions {
  now?: () => Date;
}

export function createSessionsService(
  repository: SessionsRepository,
  { now = () => new Date() }: SessionsServiceOptions = {},
): SessionsService {
  return {
    async createSession(userId) {
      const refreshToken = generateRefreshToken();
      const session = await repository.create({
        userId,
        familyId: randomUUID(),
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(now().getTime() + REFRESH_TOKEN_TTL_MS),
      });
      return { session, refreshToken };
    },

    async rotate(refreshToken) {
      const at = now();
      const nextToken = generateRefreshToken();
      const outcome = await repository.rotate(hashRefreshToken(refreshToken), hashRefreshToken(nextToken), at);
      switch (outcome.kind) {
        case 'rotated':
          return { session: outcome.session, refreshToken: nextToken };
        case 'used':
          if (at.getTime() - outcome.usedAt.getTime() <= REFRESH_REUSE_GRACE_MS) {
            throw new AppError('CONFLICT');
          }
          await repository.revokeFamily(outcome.familyId, at);
          throw new AppError('UNAUTHORIZED');
        case 'revoked':
          await repository.revokeFamily(outcome.familyId, at);
          throw new AppError('UNAUTHORIZED');
        default:
          throw new AppError('UNAUTHORIZED');
      }
    },

    findByRefreshToken(refreshToken) {
      return repository.findByTokenHash(hashRefreshToken(refreshToken));
    },

    revokeFamily(familyId) {
      return repository.revokeFamily(familyId, now());
    },

    async findActiveSession(sessionId, userId) {
      // Claims come from a verified token, but a non-UUID would make PostgreSQL throw.
      if (!UUID.test(sessionId) || !UUID.test(userId)) return null;
      return repository.findActive(sessionId, userId, now());
    },
  };
}
