import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashRefreshToken } from '../../src/modules/auth/tokens.js';
import { cookieValue, mobileLoginRequest, registerUser, setCookies, TEST_PASSWORD, webLoginRequest } from '../helpers/auth.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
let app: Express;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  // Fresh app, so every test starts with empty rate-limit counters.
  ({ app } = buildTestApp({ prisma }));
});

afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

function withoutCorrelationId(body: { error: Record<string, unknown> }) {
  return { ...body.error, correlationId: undefined };
}

describe('POST /api/v1/auth/login (Web, API-02)', () => {
  it('returns the access token in the body and the refresh token in a restricted cookie', async () => {
    const user = await registerUser(app);
    const res = await webLoginRequest(app, user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresIn', 'user']);
    expect(res.body.expiresIn).toBe(600);
    expect(res.body.user).toEqual({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: 'USER',
      createdAt: user.createdAt,
    });
    const cookies = setCookies(res);
    expect(cookies.map((c) => c.split('=')[0]).sort()).toEqual(['mp_csrf', 'mp_refresh']);
    const cookie = cookies.find((c) => c.startsWith('mp_refresh='));
    expect(cookie).toMatch(/^mp_refresh=[A-Za-z0-9_-]{43};/);
    const attributes = (cookie ?? '').split('; ').slice(1);
    expect(attributes).toEqual(expect.arrayContaining(['Max-Age=604800', 'Path=/api/v1/auth', 'HttpOnly', 'Secure', 'SameSite=Strict']));
    expect(attributes.some((a) => a.startsWith('Domain='))).toBe(false);
  });

  it('stores only the hash of the refresh token it sets', async () => {
    const user = await registerUser(app);
    const res = await webLoginRequest(app, user.email, TEST_PASSWORD);
    const token = cookieValue(setCookies(res), 'mp_refresh') ?? '';
    const rows = await prisma.session.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.refreshTokenHash).toBe(hashRefreshToken(token));
  });

  it('refuses a request without Origin (403 FORBIDDEN) and creates no session', async () => {
    const user = await registerUser(app);
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.session.count()).toBe(0);
  });

  it('refuses a foreign Origin', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('POST /api/v1/auth/mobile/login (API-02)', () => {
  it('returns {accessToken, expiresIn, refreshToken, user} in the body, no-store, and no cookie', async () => {
    const user = await registerUser(app);
    const res = await mobileLoginRequest(app, user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken', 'user']);
    expect(res.body.expiresIn).toBe(600);
    expect(res.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.user.id).toBe(user.id);
  });

  it('works without an Origin header (native app)', async () => {
    const user = await registerUser(app);
    expect((await mobileLoginRequest(app, user.email, TEST_PASSWORD)).status).toBe(200);
  });
});

describe('login failures', () => {
  it.each([
    ['web', webLoginRequest],
    ['mobile', mobileLoginRequest],
  ])('%s: wrong password, unknown email and disabled account give identical 401 INVALID_CREDENTIALS', async (_label, login) => {
    const user = await registerUser(app);
    const disabled = await registerUser(app);
    await prisma.user.update({ where: { id: disabled.id }, data: { status: 'DISABLED' } });

    const responses = [
      await login(app, user.email, 'wrong-password-123'),
      await login(app, 'nobody@example.test', TEST_PASSWORD),
      await login(app, disabled.email, TEST_PASSWORD),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(withoutCorrelationId(res.body)).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'The email or password is incorrect.',
        correlationId: undefined,
      });
    }
    expect(await prisma.session.count()).toBe(0);
  });

  it('accepts email case and space variants', async () => {
    const user = await registerUser(app, { email: 'carol@example.test' });
    expect((await mobileLoginRequest(app, '  Carol@Example.TEST ', TEST_PASSWORD)).status).toBe(200);
    expect((await webLoginRequest(app, 'CAROL@example.test', TEST_PASSWORD)).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
  });

  it.each([
    ['missing password', { email: 'a@example.test' }],
    ['empty password', { email: 'a@example.test', password: '' }],
    ['129 code point password', { email: 'a@example.test', password: 'a'.repeat(129) }],
    ['unknown field', { email: 'a@example.test', password: 'x', role: 'ADMIN' }],
  ])('rejects a %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const res = await request(app).post('/api/v1/auth/mobile/login').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a short password at login (the register minimum does not apply)', async () => {
    const res = await mobileLoginRequest(app, 'nobody@example.test', 'x');
    expect(res.status).toBe(401);
  });
});

describe('login rate limiting', () => {
  it('shares the 5 failures/minute quota per email+IP between Web and mobile', async () => {
    const user = await registerUser(app);
    for (let i = 0; i < 3; i += 1) expect((await webLoginRequest(app, user.email, 'wrong-password')).status).toBe(401);
    for (let i = 0; i < 2; i += 1) expect((await mobileLoginRequest(app, user.email, 'wrong-password')).status).toBe(401);

    // Even the right password is refused now, on both variants.
    for (const res of [
      await mobileLoginRequest(app, user.email, TEST_PASSWORD),
      await webLoginRequest(app, ` ${user.email.toUpperCase()}`, TEST_PASSWORD),
    ]) {
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
    }
    expect(await prisma.session.count()).toBe(0);

    // Another account from the same IP is not blocked by that key.
    const other = await registerUser(app);
    expect((await mobileLoginRequest(app, other.email, TEST_PASSWORD)).status).toBe(200);
  });

  it('does not count successful logins', async () => {
    const user = await registerUser(app);
    for (let i = 0; i < 7; i += 1) {
      expect((await mobileLoginRequest(app, user.email, TEST_PASSWORD)).status).toBe(200);
    }
  });

  it('limits one IP to 20 failures/minute across different emails', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await mobileLoginRequest(app, `spray${String(i)}@example.test`, 'wrong-password')).status).toBe(401);
    }
    const res = await webLoginRequest(app, 'spray-last@example.test', 'wrong-password');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('exposes Retry-After to allowed browser origins', async () => {
    const res = await webLoginRequest(app, 'nobody@example.test', 'wrong-password');
    expect(res.headers['access-control-expose-headers']).toContain('Retry-After');
  });
});
