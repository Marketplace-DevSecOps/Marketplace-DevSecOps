import { z } from 'zod';
import { conversationSchema, createConversationInput, input, pageSchema, paginationQuery, type PaginationQuery } from '../schemas/api';
import type { HttpClient, RequestOptions } from './http';

export function createConversationsService(http: HttpClient) {
  return {
    async list(query: PaginationQuery = {}, options: RequestOptions = {}) {
      const params = input(paginationQuery, query, http.mode);
      return http.request({
        method: 'GET', path: '/conversations', statuses: [200], authenticated: true,
        schema: pageSchema(conversationSchema).refine((page) => page.items.length <= (params.limit ?? 20)),
        query: params, signal: options.signal,
      });
    },
    async create(body: z.input<typeof createConversationInput>, options: RequestOptions = {}) {
      const payload = input(createConversationInput, body, http.mode);
      return http.request({
        method: 'POST', path: '/conversations', statuses: [200, 201], authenticated: true,
        schema: conversationSchema.refine((conversation) => conversation.productId === payload.productId),
        body: payload, signal: options.signal,
      });
    },
  };
}
