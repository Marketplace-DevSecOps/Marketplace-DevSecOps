import type { RequestHandler } from 'express';
import { getAuth } from '../../middlewares/requireAuth.js';
import { getValidated } from '../../middlewares/validate.js';
import { updateCurrentUserBody } from './users.schemas.js';
import type { UsersService } from './users.service.js';

/** Personal data: never cached. */
export const USERS_CACHE_CONTROL = 'no-store';

export const updateCurrentUserSchemas = { body: updateCurrentUserBody };

export function createUsersController(service: UsersService): { getMe: RequestHandler; updateMe: RequestHandler } {
  return {
    async getMe(req, res) {
      const user = await service.getCurrent(getAuth(req).userId);
      res.set('Cache-Control', USERS_CACHE_CONTROL).json(user);
    },
    async updateMe(req, res) {
      const { body } = getValidated(req, updateCurrentUserSchemas);
      const user = await service.updateCurrent(getAuth(req).userId, body);
      res.set('Cache-Control', USERS_CACHE_CONTROL).json(user);
    },
  };
}
