// Drops and recreates the isolated test database schema from the migrations.
// Refuses to run unless DATABASE_URL_TEST is a local database named *test*
// that differs from DATABASE_URL (see tests/helpers/testDbGuard.ts).
import { runPrismaAgainstTestDb, testDatabaseUrl } from '../tests/helpers/testDbGuard.js';

let testUrl: string;
try {
  testUrl = testDatabaseUrl();
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}

const { status, output } = runPrismaAgainstTestDb(['migrate', 'reset', '--force'], testUrl);
process.stdout.write(output);
process.exit(status ?? 1);
