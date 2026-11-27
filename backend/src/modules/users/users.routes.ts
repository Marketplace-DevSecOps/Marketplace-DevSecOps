import { Router, type RequestHandler } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { validate } from '../../middlewares/validate.js';
import { createUsersController, updateCurrentUserSchemas } from './users.controller.js';
import { createUsersRepository } from './users.repository.js';
import { createUsersService } from './users.service.js';

/** API-04: the signed-in user's own account. requireAuth runs before validation. */
export function createUsersRouter(prisma: PrismaClient, requireAuth: RequestHandler): Router {
  const controller = createUsersController(createUsersService(createUsersRepository(prisma)));
  const router = Router();
  router.get('/users/me', requireAuth, controller.getMe);
  router.patch('/users/me', requireAuth, validate(updateCurrentUserSchemas), controller.updateMe);
  return router;
}
