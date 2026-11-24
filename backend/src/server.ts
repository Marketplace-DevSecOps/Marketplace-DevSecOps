import { existsSync } from 'node:fs';
import { createApp } from './app/createApp.js';
import { ConfigError, parseConfig, type Config } from './infrastructure/config.js';
import { createLogger } from './infrastructure/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function loadConfigOrExit(): Config {
  if (existsSync('.env')) process.loadEnvFile('.env');
  try {
    return parseConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const config = loadConfigOrExit();
const logger = createLogger(config);
const app = createApp({ config, logger });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'server listening');
});

server.on('error', (err) => {
  logger.fatal({ err }, 'server failed to start');
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, closing remaining connections');
    server.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
    logger.info('server closed');
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
