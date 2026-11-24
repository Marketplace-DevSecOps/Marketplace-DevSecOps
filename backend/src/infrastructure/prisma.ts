import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Config } from './config.js';

let client: PrismaClient | undefined;

/**
 * Process-wide Prisma client. Under NODE_ENV=test it connects to
 * DATABASE_URL_TEST so tests never touch the development database.
 */
export function getPrisma(config: Pick<Config, 'NODE_ENV' | 'DATABASE_URL' | 'DATABASE_URL_TEST'>): PrismaClient {
  if (client === undefined) {
    const connectionString = config.NODE_ENV === 'test' ? config.DATABASE_URL_TEST : config.DATABASE_URL;
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client === undefined) return;
  const current = client;
  client = undefined;
  await current.$disconnect();
}
