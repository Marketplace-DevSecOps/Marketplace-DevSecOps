import type { CookieOptions } from 'express';
import { REFRESH_TOKEN_TTL_MS } from './tokens.js';

/**
 * Web refresh cookie. `__Host-` is not usable because that prefix requires
 * `Path=/`, and the cookie must only reach the auth routes.
 * See docs/backend/session-policy.md ("Web transport").
 */
export const REFRESH_COOKIE = 'mp_refresh';

/** Where the cookie is sent: /api/v1/auth/refresh and /api/v1/auth/logout. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Attributes shared by set and clear, so the browser matches and removes the
 * same cookie. SameSite=Strict: the SPA only sends it with fetch() from its own
 * site, never on a cross-site navigation, so Strict costs nothing.
 */
const REFRESH_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  // Browsers accept Secure cookies on http://localhost, so dev needs no exception.
  secure: true,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
} as const satisfies CookieOptions;

export const REFRESH_COOKIE_OPTIONS: CookieOptions = { ...REFRESH_COOKIE_ATTRIBUTES, maxAge: REFRESH_TOKEN_TTL_MS };

/** For res.clearCookie: same attributes, no Max-Age (Express sets an expiry in 1970). */
export const REFRESH_COOKIE_CLEAR_OPTIONS: CookieOptions = { ...REFRESH_COOKIE_ATTRIBUTES };
