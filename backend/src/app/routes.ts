import { Router } from 'express';

/** Router mounted at /api/v1. Feature modules register their routes here. */
export function createApiRouter(): Router {
  const router = Router();
  return router;
}
