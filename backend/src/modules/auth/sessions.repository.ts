import type { PrismaClient, Role, Session } from '../../generated/prisma/client.js';

export type SessionRecord = Pick<Session, 'id' | 'userId' | 'familyId' | 'expiresAt' | 'revokedAt' | 'usedAt'>;

export type RotateOutcome =
  | { kind: 'rotated'; session: SessionRecord }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'inactive_user' }
  | { kind: 'revoked'; familyId: string }
  | { kind: 'used'; familyId: string; usedAt: Date };

export interface SessionsRepository {
  create(data: { userId: string; familyId: string; refreshTokenHash: string; expiresAt: Date }): Promise<SessionRecord>;
  findByTokenHash(refreshTokenHash: string): Promise<SessionRecord | null>;
  /**
   * In one transaction: marks the session matching `currentHash` as used and
   * creates its successor (same user, family and expiry) with `nextHash`.
   * Only an unused, unrevoked, unexpired session of an ACTIVE user is rotated;
   * otherwise the outcome says why and nothing is written.
   */
  rotate(currentHash: string, nextHash: string, now: Date): Promise<RotateOutcome>;
  /** Sets revokedAt on every unrevoked session of the family; returns those rows. */
  revokeFamily(familyId: string, now: Date): Promise<{ id: string; userId: string }[]>;
  /** Session usable for an access token: not revoked, not expired, owned by `userId`, user ACTIVE. */
  findActive(sessionId: string, userId: string, now: Date): Promise<{ userId: string; role: Role } | null>;
}

const SESSION_SELECT = {
  id: true,
  userId: true,
  familyId: true,
  expiresAt: true,
  revokedAt: true,
  usedAt: true,
} as const;

type SessionWithUser = SessionRecord & { user: { status: string } };

/** Why `row` cannot be rotated at `now`, or null when it can. */
function rejection(row: SessionWithUser | null, now: Date): Exclude<RotateOutcome, { kind: 'rotated' }> | null {
  if (row === null) return { kind: 'not_found' };
  if (row.revokedAt !== null) return { kind: 'revoked', familyId: row.familyId };
  if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };
  if (row.usedAt !== null) return { kind: 'used', familyId: row.familyId, usedAt: row.usedAt };
  if (row.user.status !== 'ACTIVE') return { kind: 'inactive_user' };
  return null;
}

export function createSessionsRepository(prisma: PrismaClient): SessionsRepository {
  return {
    create(data) {
      return prisma.session.create({ data, select: SESSION_SELECT });
    },

    findByTokenHash(refreshTokenHash) {
      return prisma.session.findUnique({ where: { refreshTokenHash }, select: SESSION_SELECT });
    },

    rotate(currentHash, nextHash, now) {
      return prisma.$transaction(async (tx) => {
        const read = () =>
          tx.session.findUnique({
            where: { refreshTokenHash: currentHash },
            select: { ...SESSION_SELECT, user: { select: { status: true } } },
          });
        const row = await read();
        const early = rejection(row, now);
        if (early !== null || row === null) return early ?? { kind: 'not_found' };

        // Conditional claim: the UPDATE takes the row lock, so of two concurrent
        // rotations only one matches `usedAt: null` (Read Committed re-checks the
        // WHERE clause after the lock is released).
        const claimed = await tx.session.updateMany({
          where: { id: row.id, usedAt: null, revokedAt: null },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) {
          // Lost the race: re-read the committed state to classify it.
          return rejection(await read(), now) ?? { kind: 'not_found' };
        }

        const successor = await tx.session.create({
          data: { userId: row.userId, familyId: row.familyId, refreshTokenHash: nextHash, expiresAt: row.expiresAt },
          select: SESSION_SELECT,
        });
        await tx.session.update({ where: { id: row.id }, data: { replacedById: successor.id } });
        return { kind: 'rotated', session: successor };
      });
    },

    revokeFamily(familyId, now) {
      return prisma.session.updateManyAndReturn({
        where: { familyId, revokedAt: null },
        data: { revokedAt: now },
        select: { id: true, userId: true },
      });
    },

    async findActive(sessionId, userId, now) {
      const row = await prisma.session.findFirst({
        where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now }, user: { status: 'ACTIVE' } },
        select: { userId: true, user: { select: { role: true } } },
      });
      return row === null ? null : { userId: row.userId, role: row.user.role };
    },
  };
}
