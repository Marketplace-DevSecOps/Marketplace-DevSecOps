import { Prisma, type PrismaClient, type User } from '../../generated/prisma/client.js';
import { AppError } from '../../middlewares/errors.js';

export type UserRow = Pick<User, 'id' | 'email' | 'displayName' | 'role' | 'createdAt'>;

/** Row used by login only: the hash never leaves the auth service. */
export type CredentialsRow = UserRow & Pick<User, 'passwordHash' | 'status'>;

export interface NewUser {
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface AuthRepository {
  /** Creates a USER account. Throws AppError('CONFLICT') when the email is taken. */
  createUser(user: NewUser): Promise<UserRow>;
  findCredentialsByEmail(email: string): Promise<CredentialsRow | null>;
  /** Rehash on login: only replaces the hash it was given, so a concurrent password change wins. */
  updatePasswordHash(userId: string, previousHash: string, nextHash: string): Promise<void>;
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
    findCredentialsByEmail(email) {
      return prisma.user.findUnique({
        where: { email },
        select: { ...USER_SELECT, passwordHash: true, status: true },
      });
    },
    async updatePasswordHash(userId, previousHash, nextHash) {
      await prisma.user.updateMany({ where: { id: userId, passwordHash: previousHash }, data: { passwordHash: nextHash } });
    },
  };
}
