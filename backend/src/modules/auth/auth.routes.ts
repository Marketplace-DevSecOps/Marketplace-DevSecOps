import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Config } from '../../infrastructure/config.js';
import { createLoginLimiters } from '../../middlewares/rateLimit.js';
import { requireAllowedOrigin } from '../../middlewares/requireAllowedOrigin.js';
import { validate } from '../../middlewares/validate.js';
import { createAuthController, loginSchemas, registerSchemas } from './auth.controller.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService } from './auth.service.js';
import { createPasswordHasher } from './password.js';
import type { SessionsService } from './sessions.service.js';
import type { AccessTokenService } from './tokens.js';

export interface AuthRouterDependencies {
  prisma: PrismaClient;
  config: Pick<Config, 'CORS_ORIGINS'>;
  sessions: SessionsService;
  tokens: AccessTokenService;
}

/** API-01 (register) and API-02 (Web and mobile login). */
export function createAuthRouter({ prisma, config, sessions, tokens }: AuthRouterDependencies): Router {
  const service = createAuthService(createAuthRepository(prisma), createPasswordHasher(), { sessions, tokens });
  const controller = createAuthController(service);
  // One set of limiters per router: both login variants share the same counters.
  const limiters = createLoginLimiters();
  const router = Router();

  router.post('/auth/register', validate(registerSchemas), controller.register);
  router.post(
    '/auth/login',
    requireAllowedOrigin(config.CORS_ORIGINS),
    limiters.perIp,
    limiters.perAccountIp,
    validate(loginSchemas),
    controller.webLogin,
  );
  // No Origin check and no cookie handling: native apps send no Origin.
  router.post('/auth/mobile/login', limiters.perIp, limiters.perAccountIp, validate(loginSchemas), controller.mobileLogin);
  return router;
}
