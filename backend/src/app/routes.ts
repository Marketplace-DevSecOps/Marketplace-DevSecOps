import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import { createCategoriesRouter } from '../modules/categories/categories.routes.js';
import { createHealthRouter } from '../modules/health/health.routes.js';

export interface ApiDependencies {
  prisma: PrismaClient;
}

/** Router mounted at /api/v1. Feature modules register their routes here. */
export function createApiRouter({ prisma }: ApiDependencies): Router {
  const router = Router();
  router.use(createHealthRouter());
  router.use(createAuthRouter(prisma));
  router.use(createCategoriesRouter(prisma));
  return router;
}
