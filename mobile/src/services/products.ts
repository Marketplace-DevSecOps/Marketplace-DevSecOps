import { input, pageSchema, productSchema, productsQuery, uuid, type ProductsQuery } from '../schemas/api';
import type { HttpClient, RequestOptions } from './http';

export function createProductsService(http: HttpClient) {
  return {
    async list(query: ProductsQuery = {}, options: RequestOptions = {}) {
      const params = input(productsQuery, query, http.mode);
      return http.request({
        method: 'GET', path: '/products', statuses: [200],
        schema: pageSchema(productSchema).refine((page) => page.items.length <= (params.limit ?? 20)),
        query: params, signal: options.signal,
      });
    },
    async get(id: string, options: RequestOptions = {}) {
      const productId = input(uuid, id, http.mode).toLowerCase();
      return http.request({
        method: 'GET', path: '/products/' + productId, statuses: [200],
        schema: productSchema.refine((product) => product.id === productId), signal: options.signal,
      });
    },
  };
}
