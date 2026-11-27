import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../../middlewares/errors.js';
import { getValidated } from '../../middlewares/validate.js';
import { loginBody, refreshBody, refreshToken as refreshTokenSchema, registerBody } from './auth.schemas.js';
import type { AuthService, LoginResult } from './auth.service.js';
import {
  CSRF_COOKIE,
  CSRF_COOKIE_CLEAR_OPTIONS,
  CSRF_COOKIE_OPTIONS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_CLEAR_OPTIONS,
  REFRESH_COOKIE_OPTIONS,
  untilExpiry,
} from './cookies.js';
import { CSRF_HEADER, sameToken, type CsrfTokens } from './csrf.js';

/** Auth responses are personal and may carry credentials: never cached. */
export const AUTH_CACHE_CONTROL = 'no-store';

export const registerSchemas = { body: registerBody };
export const loginSchemas = { body: loginBody };
export const refreshSchemas = { body: refreshBody };

type Transport = 'web' | 'mobile';

export interface AuthController {
  register: RequestHandler;
  webLogin: RequestHandler;
  mobileLogin: RequestHandler;
  webRefresh: RequestHandler;
  webLogout: RequestHandler;
  mobileRefresh: RequestHandler;
  mobileLogout: RequestHandler;
}

/** Cookies parsed by cookie-parser (mounted on the Web refresh/logout routes only). */
function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : undefined;
}

function clearWebCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_CLEAR_OPTIONS);
  res.clearCookie(CSRF_COOKIE, CSRF_COOKIE_CLEAR_OPTIONS);
}

export function createAuthController(service: AuthService, csrf: CsrfTokens): AuthController {
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

  /** Refresh token from the mp_refresh cookie only; a body token is never read on Web routes. */
  function webRefreshToken(req: Request): string | undefined {
    const parsed = refreshTokenSchema.safeParse(readCookie(req, REFRESH_COOKIE));
    return parsed.success ? parsed.data : undefined;
  }

  /** Double submit: header equals cookie, and the HMAC binds it to this session family. */
  function assertCsrf(req: Request, familyId: string): void {
    const header = req.get(CSRF_HEADER);
    const cookie = readCookie(req, CSRF_COOKIE);
    if (header === undefined || cookie === undefined || !sameToken(header, cookie) || !csrf.verify(cookie, familyId)) {
      req.log.warn({ familyId }, 'auth.csrf.rejected');
      throw new AppError('FORBIDDEN');
    }
  }

  return {
    async register(req, res) {
      const { body } = getValidated(req, registerSchemas);
      const user = await service.register(body);
      res.status(201).set('Cache-Control', AUTH_CACHE_CONTROL).json(user);
    },

    /** Access token in the body (kept in memory), refresh token in the HttpOnly cookie, CSRF cookie readable. */
    async webLogin(req, res) {
      const { user, familyId, accessToken, expiresIn, refreshToken } = await login(req, 'web');
      res
        .status(200)
        .set('Cache-Control', AUTH_CACHE_CONTROL)
        .cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS)
        .cookie(CSRF_COOKIE, csrf.issue(familyId), CSRF_COOKIE_OPTIONS)
        .json({ accessToken, expiresIn, user });
    },

    /** Both tokens in the body (stored by the app in expo-secure-store); no cookie. */
    async mobileLogin(req, res) {
      const { user, accessToken, expiresIn, refreshToken } = await login(req, 'mobile');
      res.status(200).set('Cache-Control', AUTH_CACHE_CONTROL).json({ accessToken, expiresIn, refreshToken, user });
    },

    async webRefresh(req, res) {
      res.set('Cache-Control', AUTH_CACHE_CONTROL);
      const token = webRefreshToken(req);
      const familyId = token === undefined ? null : await service.findFamily(token);
      if (token === undefined || familyId === null) throw new AppError('UNAUTHORIZED');
      assertCsrf(req, familyId);
      const result = await service.refresh(token);
      req.log.info({ userId: result.userId, sessionId: result.sessionId, transport: 'web' }, 'auth.refresh.succeeded');
      res
        .status(200)
        .cookie(REFRESH_COOKIE, result.refreshToken, untilExpiry(REFRESH_COOKIE_OPTIONS, result.expiresAt))
        // Same family, so the CSRF cookie the SPA holds stays valid; only its lifetime is aligned.
        .cookie(CSRF_COOKIE, readCookie(req, CSRF_COOKIE) ?? '', untilExpiry(CSRF_COOKIE_OPTIONS, result.expiresAt))
        .json({ accessToken: result.accessToken, expiresIn: result.expiresIn });
    },

    /** Idempotent: without a known refresh cookie there is nothing to revoke, the cookies are cleared anyway. */
    async webLogout(req, res) {
      res.set('Cache-Control', AUTH_CACHE_CONTROL);
      const token = webRefreshToken(req);
      const familyId = token === undefined ? null : await service.findFamily(token);
      if (familyId !== null) {
        assertCsrf(req, familyId);
        await service.revokeFamily(familyId);
        req.log.info({ familyId, transport: 'web' }, 'auth.logout');
      }
      clearWebCookies(res);
      res.status(204).end();
    },

    async mobileRefresh(req, res) {
      const { body } = getValidated(req, refreshSchemas);
      const result = await service.refresh(body.refreshToken);
      req.log.info({ userId: result.userId, sessionId: result.sessionId, transport: 'mobile' }, 'auth.refresh.succeeded');
      res
        .status(200)
        .set('Cache-Control', AUTH_CACHE_CONTROL)
        .json({ accessToken: result.accessToken, expiresIn: result.expiresIn, refreshToken: result.refreshToken });
    },

    async mobileLogout(req, res) {
      const { body } = getValidated(req, refreshSchemas);
      await service.logout(body.refreshToken);
      req.log.info({ transport: 'mobile' }, 'auth.logout');
      res.status(204).set('Cache-Control', AUTH_CACHE_CONTROL).end();
    },
  };
}
