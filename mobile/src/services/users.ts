import { z } from 'zod';
import { currentUserSchema, input, updateUserInput } from '../schemas/api';
import type { HttpClient, RequestOptions } from './http';

export function createUsersService(http: HttpClient) {
  return {
    async getMe(options: RequestOptions = {}) {
      return http.request({
        method: 'GET', path: '/users/me', statuses: [200], schema: currentUserSchema,
        authenticated: true, signal: options.signal,
      });
    },
    async updateMe(body: z.input<typeof updateUserInput>, options: RequestOptions = {}) {
      return http.request({
        method: 'PATCH', path: '/users/me', statuses: [200], schema: currentUserSchema,
        body: input(updateUserInput, body, http.mode), authenticated: true, signal: options.signal,
      });
    },
  };
}
