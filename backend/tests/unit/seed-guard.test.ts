import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { assertSafeSeedTarget } from '../../prisma/seed-guard.js';

const LOCAL_DEV = 'postgresql://u:p@localhost:5434/marketplace_dev';

describe('seed target guard', () => {
  it.each([
    ['development', LOCAL_DEV],
    ['development', 'postgresql://u:p@db-dev:5432/marketplace_dev'],
    ['development', 'postgres://u:p@127.0.0.1:5434/marketplace_dev'],
    ['test', 'postgresql://u:p@[::1]:5433/marketplace_test'],
  ])('accepts NODE_ENV=%s with %s', (nodeEnv, url) => {
    expect(() => assertSafeSeedTarget({ NODE_ENV: nodeEnv, DATABASE_URL: url })).not.toThrow();
  });

  it.each([
    ['NODE_ENV unset', { DATABASE_URL: LOCAL_DEV }, /NODE_ENV/],
    ['NODE_ENV=production', { NODE_ENV: 'production', DATABASE_URL: LOCAL_DEV }, /NODE_ENV/],
    ['remote host', { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@db.example.com/marketplace_dev' }, /not local/],
    ['name without dev/test', { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/marketplace' }, /segment/],
    ['name merely containing dev', { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/devices' }, /segment/],
    ['non-postgres scheme', { NODE_ENV: 'development', DATABASE_URL: 'mysql://u:p@localhost/marketplace_dev' }, /postgresql/],
    ['missing URL', { NODE_ENV: 'development' }, /required/],
    ['garbage URL', { NODE_ENV: 'development', DATABASE_URL: 'not a url' }, /valid URL/],
  ])('refuses %s', (_label, env, message) => {
    expect(() => assertSafeSeedTarget(env)).toThrow(message);
  });

  it('never puts the URL or its credentials in the error', () => {
    const url = 'postgresql://admin:S3cr3t@db.internal/prod';
    expect(() => assertSafeSeedTarget({ NODE_ENV: 'development', DATABASE_URL: url })).toThrow(
      expect.objectContaining({ message: expect.not.stringMatching(/S3cr3t|db\.internal/) }),
    );
  });

  it('makes the seed script exit 1 before connecting to a production database', () => {
    const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
    const result = spawnSync(process.execPath, [tsxCli, 'prisma/seed.ts'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db.example.com:5432/prod' },
      timeout: 60_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing to seed/);
    expect(result.stdout).not.toMatch(/Seeded/);
  });
});
