import { toCategoryDto, type CategoryDto } from '../../contracts/dto.js';
import type { CategoriesRepository } from './categories.repository.js';

/** Hard cap on the reference list; categories are a small, admin-curated set. */
export const MAX_CATEGORIES = 100;

export interface CategoriesService {
  listActive(): Promise<CategoryDto[]>;
}

export function createCategoriesService(repository: CategoriesRepository): CategoriesService {
  return {
    async listActive() {
      const rows = await repository.findActive(MAX_CATEGORIES);
      return rows.map(toCategoryDto);
    },
  };
}
