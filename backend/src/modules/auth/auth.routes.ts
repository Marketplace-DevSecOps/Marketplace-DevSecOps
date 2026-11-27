import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { validate } from '../../middlewares/validate.js';
import { createAuthController, registerSchemas } from './auth.controller.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService } from './auth.service.js';
import { createPasswordHasher } from './password.js';

/** API-01 (register). Login, refresh and logout are added in later Phase 3 tasks. */
export function createAuthRouter(prisma: PrismaClient): Router {
  const service = createAuthService(createAuthRepository(prisma), createPasswordHasher());
  const controller = createAuthController(service);
  const router = Router();
  router.post('/auth/register', validate(registerSchemas), controller.register);
  return router;
}
