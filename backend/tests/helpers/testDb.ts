// Access to the real, isolated test database (docker compose service db-test).
// Prepare it once with:
//   docker compose --env-file backend/.env up -d db-test
//   npm run test:db        (applies the migrations to DATABASE_URL_TEST)
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

if (existsSync('.env')) process.loadEnvFile('.env');

/** Reads DATABASE_URL_TEST and refuses to run against the development database. */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required for database tests');
  if (url === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST must point to a database separate from DATABASE_URL');
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl() }) });
}

/** Empties every application table (migration history is kept). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE "Message", "ConversationParticipant", "Conversation", "Product", "Session", "Category", "User" CASCADE`;
}
