// Drops and recreates the isolated test database schema from the migrations.
// Refuses to run unless DATABASE_URL_TEST is set and differs from DATABASE_URL.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  process.stderr.write('DATABASE_URL_TEST is required\n');
  process.exit(1);
}
if (testUrl === process.env.DATABASE_URL) {
  process.stderr.write('DATABASE_URL_TEST must point to a database separate from DATABASE_URL\n');
  process.exit(1);
}

const result = spawnSync('npx', ['prisma', 'migrate', 'reset', '--force'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: testUrl },
});
process.exit(result.status ?? 1);
