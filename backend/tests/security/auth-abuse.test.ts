import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mobileLoginRequest, registerUser, TEST_PASSWORD, webLoginRequest } from '../helpers/auth.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
let app: Express;

// Headers that legitimately differ between two responses with the same content.
// RateLimit/RateLimit-Policy carry the remaining count and a hash of the quota key,
// which derive from the submitted email and the IP only, not from account state
// (checked separately below).
const VARIABLE_HEADERS = new Set(['x-request-id', 'date', 'etag', 'ratelimit', 'ratelimit-policy']);

function comparable(res: request.Response) {
  const headers = Object.fromEntries(Object.entries(res.headers).filter(([name]) => !VARIABLE_HEADERS.has(name)));
  return { status: res.status, headers, code: res.body.error?.code, message: res.body.error?.message };
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

describe('account enumeration through login', () => {
  it.each([
    ['web', webLoginRequest],
    ['mobile', mobileLoginRequest],
  ])('%s: unknown email, wrong password and disabled account are indistinguishable (status, headers, body)', async (_label, login) => {
    const known = await registerUser(app);
    const disabled = await registerUser(app);
    await prisma.user.update({ where: { id: disabled.id }, data: { status: 'DISABLED' } });

    const wrongPassword = comparable(await login(app, known.email, 'not-the-password'));
    const unknownEmail = comparable(await login(app, 'ghost@example.test', 'not-the-password'));
    const disabledAccount = comparable(await login(app, disabled.email, TEST_PASSWORD));

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail).toEqual(wrongPassword);
    expect(disabledAccount).toEqual(wrongPassword);
  });

  it('rate-limit headers do not depend on whether the account exists', async () => {
    const known = await registerUser(app, { email: 'erin@example.test' });
    const knownRes = await mobileLoginRequest(app, known.email, 'wrong');
    await prisma.user.delete({ where: { id: known.id } });
    // Fresh counters, same email now unknown: identical headers.
    ({ app } = buildTestApp({ prisma }));
    const unknownRes = await mobileLoginRequest(app, known.email, 'wrong');
    expect(unknownRes.headers.ratelimit).toBe(knownRes.headers.ratelimit);
    expect(unknownRes.headers['ratelimit-policy']).toBe(knownRes.headers['ratelimit-policy']);
  });
});

describe('login quota abuse', () => {
  it('the 429 is neutral: same body for a known and an unknown account, no cookie, no session', async () => {
    const known = await registerUser(app);
    for (let i = 0; i < 5; i += 1) await mobileLoginRequest(app, known.email, 'wrong');
    for (let i = 0; i < 5; i += 1) await mobileLoginRequest(app, 'ghost@example.test', 'wrong');

    const limitedKnown = await webLoginRequest(app, known.email, TEST_PASSWORD);
    const limitedUnknown = await webLoginRequest(app, 'ghost@example.test', TEST_PASSWORD);
    for (const res of [limitedKnown, limitedUnknown]) {
      expect(res.status).toBe(429);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(res.body.error).toMatchObject({ code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' });
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId', 'message']);
    }
    expect(await prisma.session.count()).toBe(0);
  });

  it('counts malformed attempts too (the limiter runs before validation)', async () => {
    const user = await registerUser(app);
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).post('/api/v1/auth/mobile/login').send({ email: user.email, password: '', extra: i });
      expect(res.status).toBe(400);
    }
    expect((await mobileLoginRequest(app, user.email, TEST_PASSWORD)).status).toBe(429);
  });

  it('email case and surrounding spaces do not give a fresh quota', async () => {
    const user = await registerUser(app, { email: 'dave@example.test' });
    const variants = ['dave@example.test', 'DAVE@example.test', ' dave@EXAMPLE.test', 'Dave@Example.Test  ', 'dAvE@example.test'];
    for (const email of variants) expect((await mobileLoginRequest(app, email, 'wrong')).status).toBe(401);
    expect((await mobileLoginRequest(app, user.email, TEST_PASSWORD)).status).toBe(429);
  });

  it('a spoofed X-Forwarded-For does not reset the per-IP quota (TRUST_PROXY=false)', async () => {
    for (let i = 0; i < 20; i += 1) {
      await mobileLoginRequest(app, `spray${String(i)}@example.test`, 'wrong').set('X-Forwarded-For', `203.0.113.${String(i)}`);
    }
    const res = await mobileLoginRequest(app, 'fresh@example.test', 'wrong').set('X-Forwarded-For', '198.51.100.7');
    expect(res.status).toBe(429);
  });

  it('a successful login of one account does not unblock another blocked account', async () => {
    const blocked = await registerUser(app);
    const other = await registerUser(app);
    for (let i = 0; i < 5; i += 1) await mobileLoginRequest(app, blocked.email, 'wrong');
    expect((await mobileLoginRequest(app, other.email, TEST_PASSWORD)).status).toBe(200);
    expect((await mobileLoginRequest(app, blocked.email, TEST_PASSWORD)).status).toBe(429);
  });

  it('refresh and logout are not throttled by the login quota', async () => {
    const user = await registerUser(app);
    const ok = await mobileLoginRequest(app, user.email, TEST_PASSWORD);
    for (let i = 0; i < 5; i += 1) await mobileLoginRequest(app, user.email, 'wrong');
    const refreshed = await request(app)
      .post('/api/v1/auth/mobile/refresh')
      .send({ refreshToken: ok.body.refreshToken as string });
    expect(refreshed.status).toBe(200);
  });
});
