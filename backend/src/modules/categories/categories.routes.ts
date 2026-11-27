import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { createCategoriesController } from './categories.controller.js';
import { createCategoriesRepository } from './categories.repository.js';
import { createCategoriesService } from './categories.service.js';

/**
 * API-14: public list of active categories for filters and listing forms.
 * Only id and label are returned; the list is capped (MAX_CATEGORIES).
 */
export function createCategoriesRouter(prisma: PrismaClient): Router {
  const controller = createCategoriesController(createCategoriesService(createCategoriesRepository(prisma)));
  const router = Router();
  router.get('/categories', controller.list);
  return router;
}
