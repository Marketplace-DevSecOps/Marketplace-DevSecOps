import type { Express } from 'express';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REFRESH_REUSE_GRACE_MS } from '../../src/modules/auth/sessions.service.js';
import { hashRefreshToken } from '../../src/modules/auth/tokens.js';
import { mobileLogin, registerUser, webCookieRequest, webLogin } from '../helpers/auth.js';
import { buildTestApp, TEST_ENV } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
let app: Express;

const SECRET = new TextEncoder().encode(TEST_ENV.JWT_ACCESS_SECRET);
const ISSUER = 'marketplace-api';
const AUDIENCE = 'marketplace-clients';

function me(accessToken: string) {
  return request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
}

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodePart(token: string, index: number): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[index] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
}

interface ForgeOptions {
  alg?: string;
  key?: Uint8Array;
  iss?: string;
  aud?: string;
  iatOffset?: number;
  expOffset?: number;
  claims?: Record<string, unknown>;
  omitSid?: boolean;
}

/** Signs a token like the server does, with one property changed. */
async function forge(userId: string, sessionId: string, options: ForgeOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { ...(options.omitSid ? {} : { sid: sessionId }), ...options.claims };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: options.alg ?? 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(options.iss ?? ISSUER)
    .setAudience(options.aud ?? AUDIENCE)
    .setIssuedAt(now + (options.iatOffset ?? 0))
    .setExpirationTime(now + (options.expOffset ?? 600))
    .sign(options.key ?? SECRET);
}

async function signedIn() {
  const user = await registerUser(app);
  const login = await mobileLogin(app, user.email);
  const row = await prisma.session.findUniqueOrThrow({ where: { refreshTokenHash: hashRefreshToken(login.refreshToken) } });
  return { user, sessionId: row.id, ...login };
}

function expectNeutral401(res: request.Response) {
  expect(res.status).toBe(401);
  expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId', 'message']);
  expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED', message: 'Authentication is required.' });
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

describe('access token verification on GET /users/me', () => {
  it('accepts the genuine token and a server-identical forged copy (control)', async () => {
    const { user, sessionId, accessToken } = await signedIn();
    expect((await me(accessToken)).status).toBe(200);
    expect((await me(await forge(user.id, sessionId))).status).toBe(200);
  });

  it('refuses a tampered payload (sub switched to another user)', async () => {
    const { accessToken } = await signedIn();
    const victim = await registerUser(app);
    const [header, , signature] = accessToken.split('.');
    const payload = { ...decodePart(accessToken, 1), sub: victim.id };
    expectNeutral401(await me(`${header ?? ''}.${b64url(payload)}.${signature ?? ''}`));
  });

  it('refuses a tampered signature', async () => {
    const { accessToken } = await signedIn();
    // Change the first signature character: the last one carries only 4 significant bits of the
    // 32-byte HMAC, so swapping it (e.g. A <-> B) can decode to the same bytes and stay valid.
    const [header, payload, signature = ''] = accessToken.split('.');
    const first = signature.startsWith('A') ? 'B' : 'A';
    expectNeutral401(await me(`${header ?? ''}.${payload ?? ''}.${first}${signature.slice(1)}`));
  });

  it.each<[string, ForgeOptions]>([
    ['signed with another secret', { key: new TextEncoder().encode('another-secret-that-is-long-enough-0123456789') }],
    ['expired', { iatOffset: -1200, expOffset: -600 }],
    // A far exp does not extend the lifetime: maxTokenAge caps it at 600 s after iat.
    ['with a far exp issued more than 10 minutes ago', { iatOffset: -601, expOffset: 3600 }],
    ['wrong audience', { aud: 'another-api' }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['HS512 with the right secret', { alg: 'HS512' }],
    ['HS384 with the right secret', { alg: 'HS384' }],
    ['missing sid', { omitSid: true }],
    ['non-string sid', { omitSid: true, claims: { sid: 42 } }],
  ])('refuses a token %s', async (_label, options) => {
    const { user, sessionId } = await signedIn();
    expectNeutral401(await me(await forge(user.id, sessionId, options)));
  });

  it('refuses alg "none" (unsigned token)', async () => {
    const { user, sessionId } = await signedIn();
    const now = Math.floor(Date.now() / 1000);
    const header = b64url({ alg: 'none', typ: 'JWT' });
    const payload = b64url({ sub: user.id, sid: sessionId, iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + 600 });
    expectNeutral401(await me(`${header}.${payload}.`));
    expectNeutral401(await me(`${header}.${payload}.AAAA`));
  });

  it('refuses a token whose sid belongs to another user', async () => {
    const a = await signedIn();
    const b = await signedIn();
    expectNeutral401(await me(await forge(a.user.id, b.sessionId)));
  });
});

describe('access after logout or revocation', () => {
  it('web logout invalidates the access token immediately', async () => {
    const user = await registerUser(app);
    const { accessToken, cookies } = await webLogin(app, user.email);
    expect((await me(accessToken)).status).toBe(200);
    expect((await webCookieRequest(app, '/auth/logout', cookies)).status).toBe(204);
    expectNeutral401(await me(accessToken));
  });

  it('mobile logout invalidates the access token immediately', async () => {
    const { accessToken, refreshToken } = await signedIn();
    await request(app).post('/api/v1/auth/mobile/logout').send({ refreshToken });
    expectNeutral401(await me(accessToken));
  });

  it('refresh reuse revokes every access token of the family', async () => {
    const { accessToken, refreshToken } = await signedIn();
    const rotated = await request(app).post('/api/v1/auth/mobile/refresh').send({ refreshToken });
    expect(rotated.status).toBe(200);
    // Decision 8: the rotated row's access token still works until revocation.
    expect((await me(accessToken)).status).toBe(200);
    expect((await me(rotated.body.accessToken as string)).status).toBe(200);

    await prisma.session.update({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      data: { usedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) },
    });
    expect((await request(app).post('/api/v1/auth/mobile/refresh').send({ refreshToken })).status).toBe(401);
    expectNeutral401(await me(accessToken));
    expectNeutral401(await me(rotated.body.accessToken as string));
  });

  it('logging out one device does not end another login of the same user', async () => {
    const user = await registerUser(app);
    const phone = await mobileLogin(app, user.email);
    const laptop = await mobileLogin(app, user.email);
    await request(app).post('/api/v1/auth/mobile/logout').send({ refreshToken: phone.refreshToken });
    expectNeutral401(await me(phone.accessToken));
    expect((await me(laptop.accessToken)).status).toBe(200);
  });

  it('disabling the account invalidates its access and refresh tokens', async () => {
    const { user, accessToken, refreshToken } = await signedIn();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    expectNeutral401(await me(accessToken));
    expect((await request(app).post('/api/v1/auth/mobile/refresh').send({ refreshToken })).status).toBe(401);
  });
});

describe('concurrent refresh over HTTP', () => {
  it('two simultaneous mobile refreshes of one token: one 200, one 409, family intact', async () => {
    const { refreshToken } = await signedIn();
    const send = () => request(app).post('/api/v1/auth/mobile/refresh').send({ refreshToken });
    const results = await Promise.all([send(), send()]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const winner = results.find((res) => res.status === 200);
    const next = await request(app)
      .post('/api/v1/auth/mobile/refresh')
      .send({ refreshToken: winner?.body.refreshToken as string });
    expect(next.status).toBe(200);
    expect(await prisma.session.count({ where: { revokedAt: { not: null } } })).toBe(0);
  });

  it('two simultaneous web refreshes with the same cookie: one 200, one 409', async () => {
    const user = await registerUser(app);
    const { cookies } = await webLogin(app, user.email);
    const results = await Promise.all([
      webCookieRequest(app, '/auth/refresh', cookies),
      webCookieRequest(app, '/auth/refresh', cookies),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await prisma.session.count({ where: { revokedAt: { not: null } } })).toBe(0);
  });
});
