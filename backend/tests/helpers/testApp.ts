import { Writable } from 'node:stream';
import type { Router } from 'express';
import { createApp } from '../../src/app/createApp.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { parseConfig } from '../../src/infrastructure/config.js';
import { createLogger } from '../../src/infrastructure/logger.js';

export const ALLOWED_ORIGIN = 'http://localhost:5173';

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: ALLOWED_ORIGIN,
  TRUST_PROXY: 'false',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/marketplace_dev',
  DATABASE_URL_TEST: 'postgresql://user:pass@localhost:5433/marketplace_test',
} as const;

export interface TestAppOptions {
  env?: Record<string, string>;
  extendApiRouter?: (router: Router) => void;
  /** Database client for tests that hit the real test database (see testDb.ts). */
  prisma?: PrismaClient;
  /** When true, logs are captured in memory instead of being discarded. */
  captureLogs?: boolean;
}

export function buildTestApp({ env = {}, extendApiRouter, prisma, captureLogs = false }: TestAppOptions = {}) {
  const config = parseConfig({ ...TEST_ENV, ...(captureLogs ? { LOG_LEVEL: 'info' } : {}), ...env });
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger(config, stream);
  const app = createApp({
    config,
    logger,
    ...(prisma ? { prisma } : {}),
    ...(extendApiRouter ? { extendApiRouter } : {}),
  });
  return { app, logger, logs: () => lines.join('') };
}
