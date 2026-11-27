import type { RequestHandler } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { registerBody } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

/** Auth responses are personal and may carry credentials: never cached. */
export const AUTH_CACHE_CONTROL = 'no-store';

export const registerSchemas = { body: registerBody };

export function createAuthController(service: AuthService): { register: RequestHandler } {
  return {
    async register(req, res) {
      const { body } = getValidated(req, registerSchemas);
      const user = await service.register(body);
      res.status(201).set('Cache-Control', AUTH_CACHE_CONTROL).json(user);
    },
  };
}
