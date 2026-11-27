import cookieParser from 'cookie-parser';
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Config } from '../../infrastructure/config.js';
import { createLoginLimiters } from '../../middlewares/rateLimit.js';
import { requireAllowedOrigin } from '../../middlewares/requireAllowedOrigin.js';
import { validate } from '../../middlewares/validate.js';
import { createAuthController, loginSchemas, refreshSchemas, registerSchemas } from './auth.controller.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService } from './auth.service.js';
import { createCsrfTokens } from './csrf.js';
import { createPasswordHasher } from './password.js';
import type { SessionsService } from './sessions.service.js';
import type { AccessTokenService } from './tokens.js';

export interface AuthRouterDependencies {
  prisma: PrismaClient;
  config: Pick<Config, 'CORS_ORIGINS' | 'JWT_ACCESS_SECRET'>;
  sessions: SessionsService;
  tokens: AccessTokenService;
}

/**
 * API-01 (register), API-02 (login) and API-03 (refresh/logout).
 * Web routes use cookies and require an allowed Origin (+ CSRF for refresh/logout).
 * Mobile routes (/auth/mobile/*) never parse or set cookies: the refresh token
 * only travels in the JSON body.
 */
export function createAuthRouter({ prisma, config, sessions, tokens }: AuthRouterDependencies): Router {
  const service = createAuthService(createAuthRepository(prisma), createPasswordHasher(), { sessions, tokens });
  const controller = createAuthController(service, createCsrfTokens(config.JWT_ACCESS_SECRET));
  // One set of limiters per router: both login variants share the same counters.
  const limiters = createLoginLimiters();
  const allowedOrigin = requireAllowedOrigin(config.CORS_ORIGINS);
  // Unsigned parsing only: the refresh token is opaque and checked against its hash.
  const cookies = cookieParser();
  const router = Router();

  router.post('/auth/register', validate(registerSchemas), controller.register);

  router.post('/auth/login', allowedOrigin, limiters.perIp, limiters.perAccountIp, validate(loginSchemas), controller.webLogin);
  router.post('/auth/refresh', allowedOrigin, cookies, controller.webRefresh);
  router.post('/auth/logout', allowedOrigin, cookies, controller.webLogout);

  // No Origin check: native apps send no Origin.
  router.post('/auth/mobile/login', limiters.perIp, limiters.perAccountIp, validate(loginSchemas), controller.mobileLogin);
  router.post('/auth/mobile/refresh', validate(refreshSchemas), controller.mobileRefresh);
  router.post('/auth/mobile/logout', validate(refreshSchemas), controller.mobileLogout);
  return router;
}
