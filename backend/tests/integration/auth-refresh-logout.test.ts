import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/infrastructure/config.js';
import { createRequireAuth, getAuth } from '../../src/middlewares/requireAuth.js';
import { createSessionsRepository } from '../../src/modules/auth/sessions.repository.js';
import { createSessionsService, REFRESH_REUSE_GRACE_MS } from '../../src/modules/auth/sessions.service.js';
import { createAccessTokenService, hashRefreshToken } from '../../src/modules/auth/tokens.js';
import {
  cookieValue,
  mobileLogin,
  registerUser,
  setCookies,
  webCookieRequest,
  webCredentials,
  webLogin,
} from '../helpers/auth.js';
import { ALLOWED_ORIGIN, buildTestApp, TEST_ENV } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
const requireAuth = createRequireAuth({
  tokens: createAccessTokenService(parseConfig(TEST_ENV)),
  sessions: createSessionsService(createSessionsRepository(prisma)),
});
const { app } = buildTestApp({
  prisma,
  extendApiRouter: (router) => {
    router.get('/__test/protected', requireAuth, (req, res) => {
      res.json(getAuth(req));
    });
  },
});

function protectedGet(server: Express, accessToken: string) {
  return request(server).get('/api/v1/__test/protected').set('Authorization', `Bearer ${accessToken}`);
}

async function sessionOf(refreshToken: string) {
  return prisma.session.findUniqueOrThrow({ where: { refreshTokenHash: hashRefreshToken(refreshToken) } });
}

/** Moves the usedAt of a rotated token out of the grace window. */
async function ageUsedToken(refreshToken: string) {
  await prisma.session.update({
    where: { refreshTokenHash: hashRefreshToken(refreshToken) },
    data: { usedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) },
  });
}

function mobilePost(path: '/auth/mobile/refresh' | '/auth/mobile/logout', body: object) {
  return request(app).post(`/api/v1${path}`).send(body);
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

describe('POST /api/v1/auth/refresh (Web, API-03)', () => {
  it('rotates the cookie and returns a usable access token', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    const res = await webCookieRequest(app, '/auth/refresh', cookies);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresIn']);
    expect(res.body.expiresIn).toBe(600);

    const next = setCookies(res);
    const oldToken = cookieValue(cookies, 'mp_refresh');
    const newToken = cookieValue(next, 'mp_refresh');
    expect(newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken).not.toBe(oldToken);
    // The CSRF token is bound to the family, so it is kept.
    expect(cookieValue(next, 'mp_csrf')).toBe(cookieValue(cookies, 'mp_csrf'));

    const me = await protectedGet(app, res.body.accessToken as string);
    expect(me.status).toBe(200);
    expect(me.body.userId).toBe(user.id);
    expect(me.body.sessionId).toBe((await sessionOf(newToken ?? '')).id);
  });

  it('can rotate again with the new cookie', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    const first = await webCookieRequest(app, '/auth/refresh', cookies);
    const merged = [...setCookies(first)];
    const second = await webCookieRequest(app, '/auth/refresh', merged);
    expect(second.status).toBe(200);
  });

  it('ignores a refresh token sent in the body (wrong transport) → 401', async () => {
    const user = await registerUser(app);
    const { refreshToken } = await mobileLogin(app, user.email);
    const res = await request(app).post('/api/v1/auth/refresh').set('Origin', ALLOWED_ORIGIN).send({ refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect((await sessionOf(refreshToken)).usedAt).toBeNull();
  });

  it('refuses a mobile refresh token placed in the cookie without a valid CSRF token', async () => {
    const user = await registerUser(app);
    const { refreshToken } = await mobileLogin(app, user.email);
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', `mp_refresh=${refreshToken}`);
    expect(res.status).toBe(403);
    expect((await sessionOf(refreshToken)).usedAt).toBeNull();
  });

  it('returns 409 for a duplicate within the grace window and 401 + family revocation after it', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    expect((await webCookieRequest(app, '/auth/refresh', cookies)).status).toBe(200);
    const duplicate = await webCookieRequest(app, '/auth/refresh', cookies);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const oldToken = cookieValue(cookies, 'mp_refresh') ?? '';
    await ageUsedToken(oldToken);
    expect((await webCookieRequest(app, '/auth/refresh', cookies)).status).toBe(401);
    const rows = await prisma.session.findMany({ where: { familyId: (await sessionOf(oldToken)).familyId } });
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('answers 401 without a cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').set('Origin', ALLOWED_ORIGIN);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout (Web, API-03)', () => {
  it('revokes the family and clears both cookies with their original attributes', async () => {
    const user = await registerUser(app);
    const { cookies, accessToken } = await webLogin(app, user.email);
    const res = await webCookieRequest(app, '/auth/logout', cookies);
    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');

    const cleared = setCookies(res);
    const refresh = cleared.find((c) => c.startsWith('mp_refresh=;'));
    const csrf = cleared.find((c) => c.startsWith('mp_csrf=;'));
    expect(refresh).toBeDefined();
    expect(csrf).toBeDefined();
    for (const cookie of [refresh ?? '', csrf ?? '']) {
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Strict');
    }
    expect(refresh).toContain('Path=/api/v1/auth');
    expect(refresh).toContain('HttpOnly');
    expect(csrf).toContain('Path=/');
    expect(csrf).not.toContain('HttpOnly');

    const token = cookieValue(cookies, 'mp_refresh') ?? '';
    expect((await sessionOf(token)).revokedAt).not.toBeNull();
    expect((await webCookieRequest(app, '/auth/refresh', cookies)).status).toBe(401);
    expect((await protectedGet(app, accessToken)).status).toBe(401);
  });

  it('is idempotent: logging out again with the same cookies returns 204', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    expect((await webCookieRequest(app, '/auth/logout', cookies)).status).toBe(204);
    expect((await webCookieRequest(app, '/auth/logout', cookies)).status).toBe(204);
  });

  it('returns 204 and clears cookies when no session cookie is sent', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', ALLOWED_ORIGIN);
    expect(res.status).toBe(204);
    expect(setCookies(res).some((c) => c.startsWith('mp_refresh=;'))).toBe(true);
  });

  it('refuses a known cookie without the CSRF header (403) and keeps the session', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    const { cookie } = webCredentials(cookies);
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', ALLOWED_ORIGIN).set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await sessionOf(cookieValue(cookies, 'mp_refresh') ?? '')).revokedAt).toBeNull();
  });
});

describe('POST /api/v1/auth/mobile/refresh and /auth/mobile/logout (API-03)', () => {
  it('rotates the body token and returns {accessToken, expiresIn, refreshToken}, no-store, no cookie', async () => {
    const user = await registerUser(app);
    const { refreshToken } = await mobileLogin(app, user.email);
    const res = await mobilePost('/auth/mobile/refresh', { refreshToken });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken']);
    expect(res.body.refreshToken).not.toBe(refreshToken);
    expect((await protectedGet(app, res.body.accessToken as string)).status).toBe(200);
  });

  it('old token: 409 within the grace window, then 401 with the family revoked', async () => {
    const user = await registerUser(app);
    const { refreshToken } = await mobileLogin(app, user.email);
    const rotated = await mobilePost('/auth/mobile/refresh', { refreshToken });
    expect(rotated.status).toBe(200);
    expect((await mobilePost('/auth/mobile/refresh', { refreshToken })).status).toBe(409);

    await ageUsedToken(refreshToken);
    const reuse = await mobilePost('/auth/mobile/refresh', { refreshToken });
    expect(reuse.status).toBe(401);
    // The legitimate successor is revoked too.
    expect((await mobilePost('/auth/mobile/refresh', { refreshToken: rotated.body.refreshToken as string })).status).toBe(401);
    expect((await protectedGet(app, rotated.body.accessToken as string)).status).toBe(401);
  });

  it('logout revokes the session; repeated logout and an unknown token still give 204', async () => {
    const user = await registerUser(app);
    const { refreshToken, accessToken } = await mobileLogin(app, user.email);
    const first = await mobilePost('/auth/mobile/logout', { refreshToken });
    expect(first.status).toBe(204);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['set-cookie']).toBeUndefined();
    expect((await mobilePost('/auth/mobile/logout', { refreshToken })).status).toBe(204);
    expect((await mobilePost('/auth/mobile/logout', { refreshToken: 'unknown-token' })).status).toBe(204);
    expect((await mobilePost('/auth/mobile/refresh', { refreshToken })).status).toBe(401);
    expect((await protectedGet(app, accessToken)).status).toBe(401);
  });

  it('wrong transport: a cookie alone is ignored (400) and the session stays active', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    const { cookie, csrf } = webCredentials(cookies);
    for (const path of ['/auth/mobile/refresh', '/auth/mobile/logout'] as const) {
      const res = await request(app).post(`/api/v1${path}`).set('Cookie', cookie).set('X-CSRF-Token', csrf);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const row = await sessionOf(cookieValue(cookies, 'mp_refresh') ?? '');
    expect(row.usedAt).toBeNull();
    expect(row.revokedAt).toBeNull();
  });

  it.each([{}, { refreshToken: '' }, { refreshToken: 'has spaces' }, { refreshToken: 'a'.repeat(257) }, { refreshToken: 'x', extra: 1 }])(
    'rejects body %j with 400',
    async (body) => {
      expect((await mobilePost('/auth/mobile/refresh', body)).status).toBe(400);
    },
  );
});
