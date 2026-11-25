import { z } from 'zod';
import { currentUserSchema, emptyResponse, input, loginInput, mobileSessionSchema, refreshInput, registerInput } from '../schemas/api';
import type { HttpClient, RequestOptions } from './http';

export function createAuthService(http: HttpClient) {
  return {
    async register(body: z.input<typeof registerInput>, options: RequestOptions = {}) {
      return http.request({
        method: 'POST', path: '/auth/register', statuses: [201], schema: currentUserSchema,
        body: input(registerInput, body, http.mode), signal: options.signal,
      });
    },
    async login(body: z.input<typeof loginInput>, options: RequestOptions = {}) {
      return http.request({
        method: 'POST', path: '/auth/mobile/login', statuses: [200], schema: mobileSessionSchema,
        body: input(loginInput, body, http.mode), signal: options.signal,
      });
    },
    async refresh(body: z.input<typeof refreshInput>, options: RequestOptions = {}) {
      return http.request({
        method: 'POST', path: '/auth/mobile/refresh', statuses: [200], schema: mobileSessionSchema,
        body: input(refreshInput, body, http.mode), signal: options.signal,
      });
    },
    async logout(body: z.input<typeof refreshInput>, options: RequestOptions = {}) {
      return http.request({
        method: 'POST', path: '/auth/mobile/logout', statuses: [204], schema: emptyResponse,
        body: input(refreshInput, body, http.mode), signal: options.signal,
      });
    },
  };
}
