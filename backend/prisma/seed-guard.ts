// Guard run by prisma/seed.ts before it connects. The seed writes public
// placeholder passwords, so it may only target a local development or test
// database. Same shape as tests/helpers/testDbGuard.ts. Error messages never
// include the URL (it carries credentials).

/** NODE_ENV values allowed to seed. Unset or production is refused. */
export const SEED_NODE_ENVS: readonly string[] = ['development', 'test'];

/** Loopback, or the compose database services. */
export const SEED_DB_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]', 'db-dev', 'db-test'];

/** Database name must contain a "dev" or "test" segment, e.g. marketplace_dev. */
const SEED_DB_NAME = /(^|[_-])(dev|test)([_-]|$)/i;

/** Throws unless `env` targets a local dev/test PostgreSQL database. */
export function assertSafeSeedTarget(env: Record<string, string | undefined>): void {
  const nodeEnv = env.NODE_ENV;
  if (nodeEnv === undefined || !SEED_NODE_ENVS.includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of ${SEED_NODE_ENVS.join(', ')}`);
  }
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must use the postgresql:// scheme');
  }
  if (!SEED_DB_HOSTS.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`database host is not local (allowed: ${SEED_DB_HOSTS.join(', ')})`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!SEED_DB_NAME.test(name)) {
    throw new Error('database name does not contain a "dev" or "test" segment');
  }
}
