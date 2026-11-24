import { Router } from 'express';
import { createHealthRouter } from '../modules/health/health.routes.js';

/** Router mounted at /api/v1. Feature modules register their routes here. */
export function createApiRouter(): Router {
  const router = Router();
  router.use(createHealthRouter());
  return router;
}
