import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/infrastructure/config.js';
import { createRequireAuth, getAuth } from '../../src/middlewares/requireAuth.js';
import { createSessionsRepository } from '../../src/modules/auth/sessions.repository.js';
import { createSessionsService } from '../../src/modules/auth/sessions.service.js';
import { createAccessTokenService } from '../../src/modules/auth/tokens.js';
import { buildTestApp, TEST_ENV } from '../helpers/testApp.js';
import { createTestPrisma, createUser, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
const config = parseConfig(TEST_ENV);
const tokens = createAccessTokenService(config);
const sessions = createSessionsService(createSessionsRepository(prisma));
const requireAuth = createRequireAuth({ tokens, sessions });

const { app } = buildTestApp({
  prisma,
  extendApiRouter: (router) => {
    router.get('/__test/protected', requireAuth, (req, res) => {
      res.json(getAuth(req));
    });
  },
});

const PATH = '/api/v1/__test/protected';

async function signedIn() {
  const user = await createUser(prisma);
  const { session } = await sessions.createSession(user.id);
  const { token } = await tokens.sign({ userId: user.id, sessionId: session.id });
  return { user, session, token };
}

function get(authorization?: string) {
  const req = request(app).get(PATH);
  return authorization === undefined ? req : req.set('Authorization', authorization);
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

describe('requireAuth middleware', () => {
  it('accepts a valid token with an active session and attaches the auth context', async () => {
    const { user, session, token } = await signedIn();
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: user.id, sessionId: session.id, role: 'USER' });
  });

  it('reads the role from the database, not from the token', async () => {
    const { user, token } = await signedIn();
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');
  });

  it.each([
    ['missing header', undefined],
    ['Basic scheme', 'Basic dXNlcjpwYXNz'],
    ['bearer without token', 'Bearer '],
    ['lowercase scheme', 'bearer a.b.c'],
    ['two segments', 'Bearer abc.def'],
    ['garbage', 'Bearer not a jwt'],
    ['well-formed but unsigned garbage', 'Bearer aaaa.bbbb.cccc'],
    ['oversized header', `Bearer ${'a'.repeat(4100)}.b.c`],
  ])('rejects a %s with 401', async (_label, authorization) => {
    const res = await get(authorization);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a revoked session', async () => {
    const { session, token } = await signedIn();
    await sessions.revokeFamily(session.familyId);
    expect((await get(`Bearer ${token}`)).status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const { session, token } = await signedIn();
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await get(`Bearer ${token}`)).status).toBe(401);
  });

  it('rejects a disabled user', async () => {
    const { user, token } = await signedIn();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    expect((await get(`Bearer ${token}`)).status).toBe(401);
  });

  it('rejects a token whose sub is not the session owner', async () => {
    const { session } = await signedIn();
    const other = await createUser(prisma);
    const { token } = await tokens.sign({ userId: other.id, sessionId: session.id });
    expect((await get(`Bearer ${token}`)).status).toBe(401);
  });

  it('rejects a token for a session that does not exist', async () => {
    const user = await createUser(prisma);
    const { token } = await tokens.sign({ userId: user.id, sessionId: '00000000-0000-4000-8000-000000000000' });
    expect((await get(`Bearer ${token}`)).status).toBe(401);
  });

  it('returns the same neutral body for every failure', async () => {
    const { user, session, token } = await signedIn();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    const disabled = await get(`Bearer ${token}`);
    await sessions.revokeFamily(session.familyId);
    const revoked = await get(`Bearer ${token}`);
    const missing = await get();
    const garbage = await get('Bearer x.y.z');
    for (const res of [disabled, revoked, missing, garbage]) {
      expect(res.status).toBe(401);
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId', 'message']);
      expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED', message: 'Authentication is required.' });
    }
  });
});
