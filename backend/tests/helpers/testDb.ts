// Access to the real, isolated test database (docker compose service db-test).
// Start it with:
//   docker compose --env-file backend/.env up -d db-test
// `npm test` resets it from the migrations once per run (tests/globalSetup.ts);
// `npm run test:db` does the same by hand. Test files run one at a time
// (vitest fileParallelism: false) and call truncateAll() in beforeEach so
// every test starts from empty tables.
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import type { Category, Conversation, Product, User } from '../../src/generated/prisma/client.js';
import { assertSafeTestDatabaseUrl, runPrismaAgainstTestDb, testDatabaseUrl } from './testDbGuard.js';

export { assertSafeTestDatabaseUrl, testDatabaseUrl } from './testDbGuard.js';

export function createTestPrisma(url: string = testDatabaseUrl()): PrismaClient {
  assertSafeTestDatabaseUrl(url);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** Drops the test schema and re-applies every migration (no seed). */
export function resetTestDatabase(url: string = testDatabaseUrl()): void {
  const { status, output } = runPrismaAgainstTestDb(['migrate', 'reset', '--force'], url);
  if (status !== 0) throw new Error(`prisma migrate reset failed on the test database:\n${output}`);
}

/** Empties every application table (migration history is kept). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE "Message", "ConversationParticipant", "Conversation", "Product", "Session", "Category", "User" CASCADE`;
}

// --- Fixtures: deterministic values from a per-file counter. ---------------

let counter = 0;
const next = () => String(++counter).padStart(4, '0');

export function createUser(prisma: PrismaClient, data: Partial<Prisma.UserUncheckedCreateInput> = {}): Promise<User> {
  const n = next();
  return prisma.user.create({
    data: { email: `user${n}@example.test`, displayName: `User ${n}`, passwordHash: 'not-a-real-hash', ...data },
  });
}

export function createCategory(
  prisma: PrismaClient,
  data: Partial<Prisma.CategoryUncheckedCreateInput> = {},
): Promise<Category> {
  return prisma.category.create({ data: { label: `Category ${next()}`, ...data } });
}

export function createProduct(
  prisma: PrismaClient,
  refs: { sellerId: string; categoryId: string },
  data: Partial<Prisma.ProductUncheckedCreateInput> = {},
): Promise<Product> {
  return prisma.product.create({
    data: { ...refs, title: `Product ${next()}`, description: 'Fictitious test listing', price: '10.00', ...data },
  });
}

/** Conversation row only (no participants), seller taken from the product. */
export function createConversation(
  prisma: PrismaClient,
  refs: { product: Product; buyerId: string },
  data: Partial<Prisma.ConversationUncheckedCreateInput> = {},
): Promise<Conversation> {
  return prisma.conversation.create({
    data: { productId: refs.product.id, sellerId: refs.product.sellerId, buyerId: refs.buyerId, ...data },
  });
}

// --- Database error inspection ---------------------------------------------

export interface DbError {
  /** Prisma error code, e.g. P2002 (unique), P2003 (foreign key). */
  prismaCode: string;
  /** PostgreSQL SQLSTATE, e.g. 23505, 23503, 23514. */
  sqlState: string | undefined;
  /** Name of the violated constraint or unique index. */
  constraint: string | undefined;
}

interface DriverAdapterMeta {
  driverAdapterError?: {
    cause?: { originalCode?: string; originalMessage?: string; constraint?: { index?: string } };
  };
}

/** Awaits `operation`, expecting the database to reject it; returns the reason. */
export async function dbError(operation: PromiseLike<unknown>): Promise<DbError> {
  try {
    await operation;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) throw err;
    const cause = (err.meta as DriverAdapterMeta | undefined)?.driverAdapterError?.cause;
    const constraint = cause?.constraint?.index ?? /constraint "([^"]+)"/.exec(cause?.originalMessage ?? '')?.[1];
    return { prismaCode: err.code, sqlState: cause?.originalCode, constraint };
  }
  throw new Error('Expected the database to reject the operation, but it succeeded');
}
