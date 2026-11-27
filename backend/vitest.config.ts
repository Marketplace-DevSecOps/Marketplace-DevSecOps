import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    restoreMocks: true,
    // Rebuilds the test database from the migrations once per run.
    globalSetup: ['tests/globalSetup.ts'],
    // DB tests share one database and truncate it in beforeEach, so test
    // files must not run concurrently.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
