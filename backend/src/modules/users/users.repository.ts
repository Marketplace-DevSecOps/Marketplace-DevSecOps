import type { PrismaClient, User } from '../../generated/prisma/client.js';

export type CurrentUserRow = Pick<User, 'id' | 'email' | 'displayName' | 'role' | 'createdAt'>;

export interface UsersRepository {
  findById(userId: string): Promise<CurrentUserRow | null>;
  /** Updates only displayName; null when the user no longer exists. */
  updateDisplayName(userId: string, displayName: string): Promise<CurrentUserRow | null>;
}

const CURRENT_USER_SELECT = { id: true, email: true, displayName: true, role: true, createdAt: true } as const;

export function createUsersRepository(prisma: PrismaClient): UsersRepository {
  return {
    findById(userId) {
      return prisma.user.findUnique({ where: { id: userId }, select: CURRENT_USER_SELECT });
    },
    async updateDisplayName(userId, displayName) {
      const rows = await prisma.user.updateManyAndReturn({
        where: { id: userId },
        data: { displayName },
        select: CURRENT_USER_SELECT,
      });
      return rows[0] ?? null;
    },
  };
}
