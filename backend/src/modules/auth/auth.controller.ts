import type { Request, RequestHandler } from 'express';
import { AppError } from '../../middlewares/errors.js';
import { getValidated } from '../../middlewares/validate.js';
import { loginBody, registerBody } from './auth.schemas.js';
import type { AuthService, LoginResult } from './auth.service.js';
import { REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS } from './cookies.js';

/** Auth responses are personal and may carry credentials: never cached. */
export const AUTH_CACHE_CONTROL = 'no-store';

export const registerSchemas = { body: registerBody };
export const loginSchemas = { body: loginBody };

type Transport = 'web' | 'mobile';

export interface AuthController {
  register: RequestHandler;
  webLogin: RequestHandler;
  mobileLogin: RequestHandler;
}

export function createAuthController(service: AuthService): AuthController {
  /** Logs ids only: never the email, password or tokens. */
  async function login(req: Request, transport: Transport): Promise<LoginResult> {
    const { body } = getValidated(req, loginSchemas);
    try {
      const result = await service.login(body);
      req.log.info({ userId: result.user.id, sessionId: result.sessionId, transport }, 'auth.login.succeeded');
      return result;
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS') {
        req.log.warn({ transport }, 'auth.login.failed');
      }
      throw err;
    }
  }

  return {
    async register(req, res) {
      const { body } = getValidated(req, registerSchemas);
      const user = await service.register(body);
      res.status(201).set('Cache-Control', AUTH_CACHE_CONTROL).json(user);
    },

    /** Access token in the body (kept in memory), refresh token in the HttpOnly cookie. */
    async webLogin(req, res) {
      const { user, accessToken, expiresIn, refreshToken } = await login(req, 'web');
      res
        .status(200)
        .set('Cache-Control', AUTH_CACHE_CONTROL)
        .cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS)
        .json({ accessToken, expiresIn, user });
    },

    /** Both tokens in the body (stored by the app in expo-secure-store); no cookie. */
    async mobileLogin(req, res) {
      const { user, accessToken, expiresIn, refreshToken } = await login(req, 'mobile');
      res.status(200).set('Cache-Control', AUTH_CACHE_CONTROL).json({ accessToken, expiresIn, refreshToken, user });
    },
  };
}
