import { Prisma, type PrismaClient, type User } from '../../generated/prisma/client.js';
import { AppError } from '../../middlewares/errors.js';

export type UserRow = Pick<User, 'id' | 'email' | 'displayName' | 'role' | 'createdAt'>;

export interface NewUser {
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface AuthRepository {
  /** Creates a USER account. Throws AppError('CONFLICT') when the email is taken. */
  createUser(user: NewUser): Promise<UserRow>;
}

const USER_SELECT = { id: true, email: true, displayName: true, role: true, createdAt: true } as const;

export function createAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    async createUser({ email, displayName, passwordHash }) {
      try {
        return await prisma.user.create({
          // The role is never taken from the request.
          data: { email, displayName, passwordHash, role: 'USER' },
          select: USER_SELECT,
        });
      } catch (err) {
        // The unique index on email is the source of truth, so two concurrent
        // registrations of the same email cannot both succeed.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError('CONFLICT');
        }
        throw err;
      }
    },
  };
}
