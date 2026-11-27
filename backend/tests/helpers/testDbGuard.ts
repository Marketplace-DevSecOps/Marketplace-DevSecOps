// Guard shared by every tool that writes to or resets the test database
// (vitest globalSetup, npm run test:db, DB integration tests). It refuses any
// URL that is not a local test database, so a misconfigured DATABASE_URL_TEST
// can never wipe the development or a remote database.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/** Hosts accepted for the test database: loopback, or the compose service. */
export const TEST_DB_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]', 'db-test'];

/** Database name must contain a "test" segment, e.g. marketplace_test. */
const TEST_DB_NAME = /(^|[_-])test([_-]|$)/i;

export function loadDotEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

/** Throws unless `url` is a PostgreSQL URL to a local database named *test*. */
export function assertSafeTestDatabaseUrl(url: string, devUrl: string | undefined = process.env.DATABASE_URL): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Test database URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Test database URL must use the postgresql:// scheme');
  }
  if (!TEST_DB_HOSTS.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Refusing to use a non-local test database host (allowed: ${TEST_DB_HOSTS.join(', ')})`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!TEST_DB_NAME.test(name)) {
    throw new Error('Refusing to use a database whose name does not contain "test"');
  }
  if (devUrl && url === devUrl) {
    throw new Error('DATABASE_URL_TEST must point to a database separate from DATABASE_URL');
  }
}

/** Reads DATABASE_URL_TEST and checks it with assertSafeTestDatabaseUrl. */
export function testDatabaseUrl(): string {
  loadDotEnv();
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required for database tests');
  assertSafeTestDatabaseUrl(url);
  return url;
}

/** Same server and credentials as `url`, different database name. */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(name)}`;
  return parsed.toString();
}

/**
 * Runs a Prisma CLI command with DATABASE_URL pointed at a guarded test
 * database (prisma.config.ts reads DATABASE_URL; loadEnvFile does not
 * override it). Returns the exit status and combined output.
 */
export function runPrismaAgainstTestDb(args: string[], url: string): { status: number | null; output: string } {
  assertSafeTestDatabaseUrl(url);
  // Run the CLI entry point with the current node binary: no shell involved.
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
