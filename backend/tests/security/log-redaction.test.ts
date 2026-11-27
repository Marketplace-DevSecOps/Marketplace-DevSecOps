import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSecretKey, REDACTED } from '../../src/infrastructure/logger.js';
import { cookieValue, mobileLogin, registerUser, setCookies, webCookieRequest, webLogin } from '../helpers/auth.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const BEARER = 'eyJhbGciOiJIUzI1NiJ9.secret-access-token';
const COOKIE = 'refresh=cookie-secret-value';
const SET_COOKIE = 'session=set-cookie-secret-value';

describe('log redaction', () => {
  it('removes authorization, cookie and set-cookie headers from request logs', async () => {
    const { app, logs } = buildTestApp({
      captureLogs: true,
      extendApiRouter: (router) => {
        router.get('/__test/cookie', (_req, res) => {
          res.setHeader('Set-Cookie', SET_COOKIE);
          res.json({ ok: true });
        });
      },
    });

    await request(app).get('/api/v1/__test/cookie').set('Authorization', `Bearer ${BEARER}`).set('Cookie', COOKIE);

    const output = logs();
    expect(output).toContain('/api/v1/__test/cookie');
    expect(output).toContain(REDACTED);
    expect(output).not.toContain(BEARER);
    expect(output).not.toContain('cookie-secret-value');
    expect(output).not.toContain('set-cookie-secret-value');
  });

  it('never logs request bodies', async () => {
    const { app, logs } = buildTestApp({
      captureLogs: true,
      extendApiRouter: (router) => {
        router.post('/__test/login', (_req, res) => {
          res.status(204).end();
        });
      },
    });

    await request(app).post('/api/v1/__test/login').send({ email: 'a@example.com', password: 'body-password-123' });

    expect(logs()).not.toContain('body-password-123');
  });

  it('redacts password, token and refreshToken fields in explicit log calls', () => {
    const { logger, logs } = buildTestApp({ captureLogs: true });

    logger.info(
      { password: 'pw-1', token: 'tk-1', refreshToken: 'rt-1', user: { password: 'pw-2', refreshToken: 'rt-2' } },
      'auth event',
    );

    const output = logs();
    expect(output).toContain('auth event');
    for (const secret of ['pw-1', 'tk-1', 'rt-1', 'pw-2', 'rt-2']) {
      expect(output).not.toContain(secret);
    }
  });

  it('redacts secret fields whatever their nesting depth, including inside arrays', () => {
    const { logger, logs } = buildTestApp({ captureLogs: true });
    const event = {
      a: {
        b: {
          c: {
            password: 'deep-password',
            passwordHash: 'deep-hash',
            token: 'deep-token',
            accessToken: 'deep-access',
            refreshToken: 'deep-refresh',
            Cookie: 'deep-cookie',
            AUTHORIZATION: 'deep-authorization',
            safe: 'visible-value',
          },
        },
      },
      sessions: [{ user: { credentials: { refreshToken: 'array-refresh' } } }],
    };

    logger.info(event, 'nested event');

    const output = logs();
    expect(output).toContain('nested event');
    expect(output).toContain('visible-value');
    for (const secret of [
      'deep-password',
      'deep-hash',
      'deep-token',
      'deep-access',
      'deep-refresh',
      'deep-cookie',
      'deep-authorization',
      'array-refresh',
    ]) {
      expect(output).not.toContain(secret);
    }
    // The caller's object is left untouched.
    expect(event.a.b.c.password).toBe('deep-password');
  });

  it('redacts every key containing a secret fragment (any case, - and _ ignored) at depth 3+', () => {
    const { logger, logs } = buildTestApp({ captureLogs: true });
    const secretKeys = [
      'refreshTokenHash',
      'passwordHash',
      'newPassword',
      'currentPassword',
      'refresh_token',
      'csrfToken',
      'set-cookie',
      'X-CSRF-Token',
      'clientSecret',
      'ACCESS_TOKEN',
      'jwtValue',
      'api_key',
      // Documented over-redaction: not a secret, but contains "token".
      'tokenType',
    ];
    const leaf: Record<string, string> = {
      sessionId: 'visible-session-id',
      userId: 'visible-user-id',
      familyId: 'visible-family-id',
      email: 'visible@example.test',
    };
    for (const key of secretKeys) leaf[key] = `secret-value-of-${key}`;

    logger.info({ a: { b: { c: leaf } } }, 'fragment event');

    const output = logs();
    for (const key of secretKeys) {
      expect(output).not.toContain(`secret-value-of-${key}`);
      expect(output).toContain(`"${key}":"${REDACTED}"`);
    }
    for (const value of Object.values(leaf).filter((v) => v.startsWith('visible'))) {
      expect(output).toContain(value);
    }
  });

  it('isSecretKey matches fragments and leaves correlation ids alone', () => {
    for (const key of ['Authorization', 'COOKIE', 'refresh-token', 'mySecretThing', 'tokenType']) {
      expect(isSecretKey(key)).toBe(true);
    }
    for (const key of ['sessionId', 'userId', 'familyId', 'email', 'displayName', 'expiresAt']) {
      expect(isSecretKey(key)).toBe(false);
    }
  });

  it('redacts secrets inside circular structures', () => {
    const { logger, logs } = buildTestApp({ captureLogs: true });
    const node: Record<string, unknown> = { level1: { level2: { level3: { password: 'cycle-password' } } } };
    node.self = node;

    logger.info({ node }, 'cyclic event');

    const output = logs();
    expect(output).toContain('cyclic event');
    expect(output).not.toContain('cycle-password');
  });
});

describe('log hygiene across the real auth flows', () => {
  const prisma = createTestPrisma();
  const PASSWORD = 'log-hygiene-password-77';

  beforeAll(async () => {
    await prisma.$connect();
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await prisma.$disconnect();
  });

  it('never logs the password, access/refresh/CSRF tokens or cookie values', async () => {
    const { app, logs } = buildTestApp({ prisma, captureLogs: true });
    const user = await registerUser(app, { password: PASSWORD });

    const failed = await request(app).post('/api/v1/auth/mobile/login').send({ email: user.email, password: `${PASSWORD}-wrong` });
    expect(failed.status).toBe(401);
    const web = await webLogin(app, user.email, PASSWORD);
    const refreshed = await webCookieRequest(app, '/auth/refresh', web.cookies);
    const csrfRejected = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', `mp_refresh=${cookieValue(setCookies(refreshed), 'mp_refresh') ?? ''}`)
      .set('X-CSRF-Token', 'not-the-csrf-token');
    expect(csrfRejected.status).toBe(403);
    await webCookieRequest(app, '/auth/logout', setCookies(refreshed));

    const mobile = await mobileLogin(app, user.email, PASSWORD);
    await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${mobile.accessToken}`);
    await request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${mobile.accessToken}`).send({ displayName: 'Renamed' });
    const rotated = await request(app).post('/api/v1/auth/mobile/refresh').send({ refreshToken: mobile.refreshToken });
    // Duplicate within the grace window (409) also goes through the logs.
    await request(app).post('/api/v1/auth/mobile/refresh').send({ refreshToken: mobile.refreshToken });
    await request(app).post('/api/v1/auth/mobile/logout').send({ refreshToken: rotated.body.refreshToken as string });

    const secrets = [
      PASSWORD,
      web.accessToken,
      cookieValue(web.cookies, 'mp_refresh'),
      cookieValue(web.cookies, 'mp_csrf'),
      refreshed.body.accessToken as string,
      cookieValue(setCookies(refreshed), 'mp_refresh'),
      mobile.accessToken,
      mobile.refreshToken,
      rotated.body.accessToken as string,
      rotated.body.refreshToken as string,
    ];
    const output = logs();
    // The flows were logged (with ids), so the check below is meaningful.
    for (const event of ['auth.login.succeeded', 'auth.login.failed', 'auth.refresh.succeeded', 'auth.logout', 'auth.csrf.rejected']) {
      expect(output).toContain(event);
    }
    expect(output).toContain(user.id);
    for (const secret of secrets) {
      expect(secret, 'every secret was captured').toBeTruthy();
      expect(output).not.toContain(secret ?? '');
    }
    expect(output).not.toContain(user.email);
    expect(output).not.toMatch(/\$argon2id\$/);
  });
});
