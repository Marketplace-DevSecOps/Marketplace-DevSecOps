import { categorySchema, input, pageSchema, paginationQuery, type PaginationQuery } from '../schemas/api';
import type { HttpClient, RequestOptions } from './http';

export function createCategoriesService(http: HttpClient) {
  return {
    async list(query: PaginationQuery = {}, options: RequestOptions = {}) {
      const params = input(paginationQuery, query, http.mode);
      return http.request({
        method: 'GET', path: '/categories', statuses: [200],
        schema: pageSchema(categorySchema).refine((page) => page.items.length <= (params.limit ?? 20)),
        query: params, signal: options.signal,
      });
    },
  };
}
