import type { RequestHandler } from 'express';
import type { CategoriesService } from './categories.service.js';

/** Public, non-personalized data: shared caches may keep it briefly. */
export const CATEGORIES_CACHE_CONTROL = 'public, max-age=60';

export function createCategoriesController(service: CategoriesService): { list: RequestHandler } {
  return {
    async list(_req, res) {
      const items = await service.listActive();
      res.set('Cache-Control', CATEGORIES_CACHE_CONTROL).json({ items });
    },
  };
}
