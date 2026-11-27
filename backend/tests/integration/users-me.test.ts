import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mobileLogin, registerUser } from '../helpers/auth.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
const { app } = buildTestApp({ prisma });

async function signedInUser(displayName?: string) {
  const user = await registerUser(app, displayName === undefined ? {} : { displayName });
  const { accessToken } = await mobileLogin(app, user.email);
  return { user, accessToken };
}

function getMe(accessToken?: string) {
  const req = request(app).get('/api/v1/users/me');
  return accessToken === undefined ? req : req.set('Authorization', `Bearer ${accessToken}`);
}

function patchMe(accessToken: string, body: unknown) {
  return request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body as object);
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

describe('GET /api/v1/users/me (API-04)', () => {
  it('returns exactly the CurrentUser fields of the session user, no-store', async () => {
    const { user, accessToken } = await signedInUser();
    const res = await getMe(accessToken);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: 'USER',
      createdAt: user.createdAt,
    });
  });

  it('requires a token', async () => {
    const res = await getMe();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('reflects the role stored in the database', async () => {
    const { user, accessToken } = await signedInUser();
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    expect((await getMe(accessToken)).body.role).toBe('ADMIN');
  });
});

describe('PATCH /api/v1/users/me (API-04)', () => {
  it('updates and trims displayName only', async () => {
    const { user, accessToken } = await signedInUser();
    const res = await patchMe(accessToken, { displayName: '  New Name  ' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ id: user.id, displayName: 'New Name', email: user.email, role: 'USER' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.displayName).toBe('New Name');
  });

  it.each([
    ['role', { role: 'ADMIN' }],
    ['role with displayName', { displayName: 'Ok', role: 'ADMIN' }],
    ['email', { email: 'new@example.test' }],
    ['password', { displayName: 'Ok', password: 'another-password-123' }],
    ['status', { status: 'DISABLED' }],
    ['id', { displayName: 'Ok', id: '00000000-0000-4000-8000-000000000000' }],
    ['empty body', {}],
    ['blank displayName', { displayName: '   ' }],
    ['51 code points', { displayName: 'x'.repeat(51) }],
  ])('rejects %s with 400 VALIDATION_ERROR and changes nothing', async (_label, body) => {
    const { user, accessToken } = await signedInUser();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const res = await patchMe(accessToken, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toEqual(before);
  });

  it('requires a token before looking at the body', async () => {
    const res = await request(app).patch('/api/v1/users/me').send({ role: 'ADMIN' });
    expect(res.status).toBe(401);
  });

  it("only ever touches the token owner's account", async () => {
    const a = await signedInUser('User A');
    const b = await signedInUser('User B');
    const res = await patchMe(a.accessToken, { displayName: 'A renamed' });
    expect(res.body.id).toBe(a.user.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.user.id } })).displayName).toBe('User B');
    expect((await getMe(b.accessToken)).body.displayName).toBe('User B');
    expect((await getMe(a.accessToken)).body.displayName).toBe('A renamed');
  });
});
