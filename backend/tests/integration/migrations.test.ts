// Applies the committed migrations to a brand-new, empty database on the test
// server and checks the resulting schema. The database is created and dropped
// by this file; its name contains "test" so the URL guard accepts it.
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestPrisma, testDatabaseUrl } from '../helpers/testDb.js';
import { runPrismaAgainstTestDb, withDatabaseName } from '../helpers/testDbGuard.js';

const CLI_TIMEOUT_MS = 120_000;

const blankName = `marketplace_test_blank_${randomBytes(4).toString('hex')}`;
const blankUrl = withDatabaseName(testDatabaseUrl(), blankName);
const migrationNames = readdirSync('prisma/migrations', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const admin = createTestPrisma();
let blank: PrismaClient;
let tablesBeforeDeploy: number;
let deploy: { status: number | null; output: string };

beforeAll(async () => {
  // blankName is generated above (hex only), never user input.
  await admin.$executeRawUnsafe(`CREATE DATABASE "${blankName}"`);
  blank = createTestPrisma(blankUrl);
  const [row] = await blank.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
  tablesBeforeDeploy = row?.n ?? -1;
  deploy = runPrismaAgainstTestDb(['migrate', 'deploy'], blankUrl);
}, CLI_TIMEOUT_MS);

afterAll(async () => {
  await blank?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${blankName}" WITH (FORCE)`);
  await admin.$disconnect();
});

describe('migrations on a blank database', () => {
  it('starts from a database with no tables', () => {
    expect(tablesBeforeDeploy).toBe(0);
  });

  it('applies every migration with prisma migrate deploy', async () => {
    expect(deploy.status, deploy.output).toBe(0);

    const applied = await blank.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`;
    expect(migrationNames.length).toBeGreaterThan(0);
    expect(applied.map((m) => m.migration_name)).toEqual(migrationNames);
  });

  it('reports the schema as up to date afterwards', () => {
    const status = runPrismaAgainstTestDb(['migrate', 'status'], blankUrl);
    expect(status.status, status.output).toBe(0);
    expect(status.output).toMatch(/up to date/i);
  }, CLI_TIMEOUT_MS);

  it('creates every application table', async () => {
    const rows = await blank.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual([
      'Category',
      'Conversation',
      'ConversationParticipant',
      'Message',
      'Product',
      'Session',
      'User',
    ]);
  });

  it('creates the unique indexes and business CHECK constraints', async () => {
    const indexes = await blank.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        'User_email_key',
        'Conversation_productId_buyerId_sellerId_key',
        'Message_senderId_clientMessageId_key',
        'Message_conversationId_seq_key',
      ]),
    );

    const checks = await blank.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
    expect(checks.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'Product_price_range_check',
        'Product_currency_allowlist_check',
        'Conversation_buyer_not_seller_check',
        'User_email_normalized_check',
      ]),
    );
  });

  it('declares every foreign key as ON DELETE RESTRICT', async () => {
    const fks = await blank.$queryRaw<{ conname: string; confdeltype: string }[]>`
      SELECT conname, confdeltype::text AS confdeltype FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace`;
    expect(fks.length).toBeGreaterThan(0);
    // 'r' = RESTRICT in pg_constraint.confdeltype.
    expect(fks.filter((fk) => fk.confdeltype !== 'r')).toEqual([]);
  });
});
