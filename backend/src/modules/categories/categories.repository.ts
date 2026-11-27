import type { Category, PrismaClient } from '../../generated/prisma/client.js';

export type CategoryRow = Pick<Category, 'id' | 'label'>;

export interface CategoriesRepository {
  /** Active categories ordered by label, at most `limit` rows. */
  findActive(limit: number): Promise<CategoryRow[]>;
}

export function createCategoriesRepository(prisma: PrismaClient): CategoriesRepository {
  return {
    findActive(limit) {
      return prisma.category.findMany({
        where: { isActive: true },
        select: { id: true, label: true },
        // label is unique, so this order is total and stable across calls.
        orderBy: { label: 'asc' },
        take: limit,
      });
    },
  };
}
