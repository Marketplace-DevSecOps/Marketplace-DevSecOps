import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Config } from '../infrastructure/config.js';
import { createRequireAuth } from '../middlewares/requireAuth.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import { createSessionsRepository } from '../modules/auth/sessions.repository.js';
import { createSessionsService } from '../modules/auth/sessions.service.js';
import { createAccessTokenService } from '../modules/auth/tokens.js';
import { createCategoriesRouter } from '../modules/categories/categories.routes.js';
import { createHealthRouter } from '../modules/health/health.routes.js';
import { createUsersRouter } from '../modules/users/users.routes.js';

export interface ApiDependencies {
  prisma: PrismaClient;
  config: Config;
}

/** Router mounted at /api/v1. Feature modules register their routes here. */
export function createApiRouter({ prisma, config }: ApiDependencies): Router {
  const sessions = createSessionsService(createSessionsRepository(prisma));
  const tokens = createAccessTokenService(config);
  // One instance shared by every protected route (Phase 4+ modules reuse it).
  const requireAuth = createRequireAuth({ tokens, sessions });
  const router = Router();
  router.use(createHealthRouter());
  router.use(createAuthRouter({ prisma, config, sessions, tokens }));
  router.use(createUsersRouter(prisma, requireAuth));
  router.use(createCategoriesRouter(prisma));
  return router;
}
