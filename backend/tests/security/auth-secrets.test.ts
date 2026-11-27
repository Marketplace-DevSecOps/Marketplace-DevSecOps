import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashRefreshToken } from '../../src/modules/auth/tokens.js';
import { cookieValue, mobileLogin, registerUser, setCookies, webCookieRequest, webLogin } from '../helpers/auth.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
const { app } = buildTestApp({ prisma });
const PASSWORD = 'secrets-at-rest-password-42';

/** Every column of every row, serialized by PostgreSQL itself. */
async function dumpTable(table: 'User' | 'Session'): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ j: string }[]>(`SELECT row_to_json(t)::text AS j FROM "${table}" t`);
  return rows.map((row) => row.j).join('\n');
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

describe('secrets at rest and in responses across the auth flows', () => {
  it('stores no plaintext password or token, and every stored hash matches a token the client received', async () => {
    const user = await registerUser(app, { password: PASSWORD });
    const responses: request.Response[] = [];

    const web = await webLogin(app, user.email, PASSWORD);
    responses.push(web.res);
    const webRefresh = await webCookieRequest(app, '/auth/refresh', web.cookies);
    responses.push(webRefresh);
    const webLogout = await webCookieRequest(app, '/auth/logout', setCookies(webRefresh));
    responses.push(webLogout);

    const mobile = await mobileLogin(app, user.email, PASSWORD);
    responses.push(mobile.res);
    const mobileRefresh = await request(app).post('/api/v1/auth/mobile/refresh').send({ refreshToken: mobile.refreshToken });
    responses.push(mobileRefresh);
    responses.push(await request(app).post('/api/v1/auth/mobile/logout').send({ refreshToken: mobileRefresh.body.refreshToken as string }));
    responses.push(await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${mobile.accessToken}`));

    const refreshTokens = [
      cookieValue(web.cookies, 'mp_refresh'),
      cookieValue(setCookies(webRefresh), 'mp_refresh'),
      mobile.refreshToken,
      mobileRefresh.body.refreshToken as string,
    ].filter((token): token is string => token !== undefined && token.length > 0);
    expect(refreshTokens).toHaveLength(4);
    const accessTokens = [web.accessToken, webRefresh.body.accessToken as string, mobile.accessToken, mobileRefresh.body.accessToken as string];
    const csrfToken = cookieValue(web.cookies, 'mp_csrf') ?? '';

    const stored = `${await dumpTable('User')}\n${await dumpTable('Session')}`;
    for (const secret of [PASSWORD, ...refreshTokens, ...accessTokens, csrfToken]) {
      expect(stored).not.toContain(secret);
    }

    const sessions = await prisma.session.findMany({ select: { refreshTokenHash: true } });
    expect(sessions.map((s) => s.refreshTokenHash).sort()).toEqual(refreshTokens.map(hashRefreshToken).sort());
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    for (const res of responses) {
      const exposed = JSON.stringify({ body: res.body as unknown, headers: res.headers });
      expect(exposed).not.toMatch(/passwordHash|refreshTokenHash|argon2/);
      expect(exposed).not.toContain(PASSWORD);
      expect(exposed).not.toContain(row.passwordHash);
    }
  });
});
