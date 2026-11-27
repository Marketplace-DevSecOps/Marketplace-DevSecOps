import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashRefreshToken } from '../../src/modules/auth/tokens.js';
import {
  cookieValue,
  mobileLoginRequest,
  registerUser,
  setCookies,
  TEST_PASSWORD,
  webCookieRequest,
  webCredentials,
  webLogin,
} from '../helpers/auth.js';
import { ALLOWED_ORIGIN, buildTestApp } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
let app: Express;

type CookieRoute = '/auth/refresh' | '/auth/logout';
const ROUTES: CookieRoute[] = ['/auth/refresh', '/auth/logout'];

interface Variant {
  origin?: string;
  cookie?: string;
  csrf?: string;
}

function post(path: CookieRoute, { origin, cookie, csrf }: Variant) {
  let req = request(app).post(`/api/v1${path}`);
  if (origin !== undefined) req = req.set('Origin', origin);
  if (cookie !== undefined) req = req.set('Cookie', cookie);
  if (csrf !== undefined) req = req.set('X-CSRF-Token', csrf);
  return req;
}

async function sessionState(cookies: readonly string[]) {
  const token = cookieValue(cookies, 'mp_refresh') ?? '';
  const row = await prisma.session.findUniqueOrThrow({ where: { refreshTokenHash: hashRefreshToken(token) } });
  return { usedAt: row.usedAt, revokedAt: row.revokedAt, count: await prisma.session.count() };
}

/** Parses one Set-Cookie line into its value and attribute list. */
function parseSetCookie(line: string) {
  const [pair = '', ...attributes] = line.split('; ');
  return { value: pair.slice(pair.indexOf('=') + 1), attributes };
}

function findCookie(cookies: readonly string[], name: string) {
  const line = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  expect(line, `Set-Cookie ${name}`).toBeDefined();
  return parseSetCookie(line ?? '');
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  ({ app } = buildTestApp({ prisma }));
});

afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

describe.each(ROUTES)('CSRF and Origin on POST %s', (path) => {
  async function victim() {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    return { cookies, ...webCredentials(cookies) };
  }

  it('refuses a missing Origin with 403 FORBIDDEN and changes nothing', async () => {
    const { cookies, cookie, csrf } = await victim();
    const before = await sessionState(cookies);
    const res = await post(path, { cookie, csrf });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await sessionState(cookies)).toEqual(before);
  });

  it('refuses a foreign Origin with 403 CORS_FORBIDDEN and changes nothing', async () => {
    const { cookies, cookie, csrf } = await victim();
    const before = await sessionState(cookies);
    const res = await post(path, { origin: 'https://evil.example', cookie, csrf });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_FORBIDDEN');
    expect(await sessionState(cookies)).toEqual(before);
  });

  it('refuses an allowed Origin without X-CSRF-Token', async () => {
    const { cookies, cookie } = await victim();
    const before = await sessionState(cookies);
    const res = await post(path, { origin: ALLOWED_ORIGIN, cookie });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await sessionState(cookies)).toEqual(before);
  });

  it('refuses a header that does not match the cookie', async () => {
    const { cookies, cookie, csrf } = await victim();
    const before = await sessionState(cookies);
    const forged = `${csrf.slice(0, -1)}${csrf.endsWith('A') ? 'B' : 'A'}`;
    const res = await post(path, { origin: ALLOWED_ORIGIN, cookie, csrf: forged });
    expect(res.status).toBe(403);
    expect(await sessionState(cookies)).toEqual(before);
  });

  it('refuses a matching header and cookie forged by the attacker (no valid HMAC)', async () => {
    const { cookies } = await victim();
    const before = await sessionState(cookies);
    const fake = `${'A'.repeat(22)}.${'B'.repeat(43)}`;
    const cookie = `mp_refresh=${cookieValue(cookies, 'mp_refresh') ?? ''}; mp_csrf=${fake}`;
    const res = await post(path, { origin: ALLOWED_ORIGIN, cookie, csrf: fake });
    expect(res.status).toBe(403);
    expect(await sessionState(cookies)).toEqual(before);
  });

  it("refuses a valid CSRF token taken from another user's login", async () => {
    const { cookies } = await victim();
    const attacker = await registerUser(app);
    const own = await webLogin(app, attacker.email);
    const attackerCsrf = cookieValue(own.cookies, 'mp_csrf') ?? '';
    const before = await sessionState(cookies);
    const cookie = `mp_refresh=${cookieValue(cookies, 'mp_refresh') ?? ''}; mp_csrf=${attackerCsrf}`;
    const res = await post(path, { origin: ALLOWED_ORIGIN, cookie, csrf: attackerCsrf });
    expect(res.status).toBe(403);
    expect(await sessionState(cookies)).toEqual(before);
  });

  it('accepts the genuine Origin, cookie and header', async () => {
    const { cookies } = await victim();
    const res = await webCookieRequest(app, path, cookies);
    expect(res.status).toBe(path === '/auth/refresh' ? 200 : 204);
  });
});

describe('Set-Cookie attributes', () => {
  it('login sets mp_refresh and mp_csrf with the documented attributes', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    expect(cookies).toHaveLength(2);

    const refresh = findCookie(cookies, 'mp_refresh');
    expect(refresh.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(refresh.attributes.filter((a) => !a.startsWith('Expires=')).sort()).toEqual(
      ['HttpOnly', 'Max-Age=604800', 'Path=/api/v1/auth', 'SameSite=Strict', 'Secure'].sort(),
    );

    const csrf = findCookie(cookies, 'mp_csrf');
    expect(csrf.value).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(csrf.attributes.filter((a) => !a.startsWith('Expires=')).sort()).toEqual(
      ['Max-Age=604800', 'Path=/', 'SameSite=Strict', 'Secure'].sort(),
    );
  });

  it('refresh re-sets both cookies with the same attributes and a Max-Age capped by the family expiry', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    const res = await webCookieRequest(app, '/auth/refresh', cookies);
    const next = setCookies(res);
    for (const name of ['mp_refresh', 'mp_csrf']) {
      const { attributes } = findCookie(next, name);
      const maxAge = Number(attributes.find((a) => a.startsWith('Max-Age='))?.slice('Max-Age='.length));
      expect(maxAge).toBeGreaterThan(604_700);
      expect(maxAge).toBeLessThanOrEqual(604_800);
      expect(attributes).toEqual(expect.arrayContaining(['Secure', 'SameSite=Strict']));
    }
    expect(findCookie(next, 'mp_refresh').attributes).toEqual(expect.arrayContaining(['HttpOnly', 'Path=/api/v1/auth']));
    expect(findCookie(next, 'mp_csrf').attributes).not.toContain('HttpOnly');
  });

  it('logout clears both cookies with the same Path, Secure, SameSite and HttpOnly flags', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    const cleared = setCookies(await webCookieRequest(app, '/auth/logout', cookies));
    for (const name of ['mp_refresh', 'mp_csrf']) {
      const set = findCookie(cookies, name).attributes.filter((a) => !a.startsWith('Expires=') && !a.startsWith('Max-Age='));
      const clear = findCookie(cleared, name);
      expect(clear.value).toBe('');
      expect(clear.attributes).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(clear.attributes.filter((a) => !a.startsWith('Expires=')).sort()).toEqual(set.sort());
    }
  });
});

describe('mobile routes and cookies', () => {
  it('never return Set-Cookie (login, refresh, logout)', async () => {
    const user = await registerUser(app);
    const login = await mobileLoginRequest(app, user.email, TEST_PASSWORD);
    const refresh = await request(app).post('/api/v1/auth/mobile/refresh').send({ refreshToken: login.body.refreshToken as string });
    const logout = await request(app).post('/api/v1/auth/mobile/logout').send({ refreshToken: refresh.body.refreshToken as string });
    for (const res of [login, refresh, logout]) expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('ignore a valid mp_refresh cookie when the body names another token', async () => {
    const user = await registerUser(app);
    const web = await webLogin(app, user.email);
    const mobile = await mobileLoginRequest(app, user.email, TEST_PASSWORD);
    const { cookie } = webCredentials(web.cookies);
    const res = await request(app)
      .post('/api/v1/auth/mobile/logout')
      .set('Cookie', cookie)
      .send({ refreshToken: mobile.body.refreshToken as string });
    expect(res.status).toBe(204);
    // Only the body token's session is revoked; the Web session stays active.
    const webState = await sessionState(web.cookies);
    expect(webState.revokedAt).toBeNull();
    expect((await webCookieRequest(app, '/auth/refresh', web.cookies)).status).toBe(200);
  });
});

describe('CORS preflight for the Web auth routes', () => {
  it('allows X-CSRF-Token from the allowed origin', async () => {
    const res = await request(app)
      .options('/api/v1/auth/refresh')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-csrf-token');
  });

  it('rejects a preflight from a foreign origin', async () => {
    const res = await request(app)
      .options('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
