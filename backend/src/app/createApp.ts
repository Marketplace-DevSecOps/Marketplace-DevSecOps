import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from '../infrastructure/config.js';
import { correlationId } from '../middlewares/correlationId.js';
import { cors } from '../middlewares/cors.js';
import { errorHandler, notFoundHandler } from '../middlewares/errors.js';
import { createApiRouter } from './routes.js';

export interface AppOptions {
  config: Config;
  logger: Logger;
  /** Hook to register extra routes on the /api/v1 router (used by tests only). */
  extendApiRouter?: (router: Router) => void;
}

/** Builds the Express application without listening, so tests can drive it with Supertest. */
export function createApp({ config, logger, extendApiRouter }: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  // 1. Correlation id (accepted from X-Request-Id if safe, otherwise generated).
  app.use(correlationId());

  // 2. Structured request logs; sensitive headers and fields are redacted by the logger.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).correlationId,
      customLogLevel: (_req, res, err) => {
        if (err !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // 3. Security headers and CORS allowlist.
  app.use(helmet());
  app.use(cors(config.CORS_ORIGINS));

  // 4. Body size limit (JSON only).
  app.use(express.json({ limit: config.BODY_LIMIT, strict: true }));

  // 5. Rate limiting (quotas): added in a later phase.
  // 6. Authentication: route-level middleware added with the auth module.
  // 7. Validation (Zod) and authorization: route-level middleware per endpoint.

  // 8. Versioned API router.
  const apiRouter = createApiRouter();
  extendApiRouter?.(apiRouter);
  app.use('/api/v1', apiRouter);

  // 9. Unknown routes, then central error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
