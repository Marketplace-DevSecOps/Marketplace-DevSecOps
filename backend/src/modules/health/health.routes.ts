import { Router } from 'express';

/**
 * API-13: public liveness probe. Deliberately minimal: no version, environment,
 * hostname or dependency detail is exposed.
 */
export function createHealthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });
  return router;
}
