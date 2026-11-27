import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
const { app, logs } = buildTestApp({ prisma, captureLogs: true });

const PASSWORD = 'register-test-password';
const valid = { email: 'alice@example.test', displayName: 'Alice', password: PASSWORD };

function register(body: unknown) {
  return request(app).post('/api/v1/auth/register').send(body as object);
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

describe('POST /api/v1/auth/register (API-01)', () => {
  it('creates a USER account and returns exactly the CurrentUser fields', async () => {
    const res = await register(valid);

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'displayName', 'email', 'id', 'role']);
    expect(res.body).toMatchObject({ email: 'alice@example.test', displayName: 'Alice', role: 'USER' });
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
  });

  it('normalizes the email (trim + lowercase) and trims the display name', async () => {
    const res = await register({ ...valid, email: '  Alice@Example.TEST ', displayName: '  Alice  ' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('alice@example.test');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.email).toBe('alice@example.test');
    expect(row.displayName).toBe('Alice');
  });

  it('stores only an Argon2id hash and never returns or logs it', async () => {
    const res = await register(valid);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2|status/);
    expect(logs()).not.toContain(PASSWORD);
    expect(logs()).not.toContain(row.passwordHash);
  });

  it.each([{ role: 'ADMIN' }, { role: 'USER' }, { status: 'ACTIVE' }, { passwordHash: 'x' }])(
    'rejects an injected field %j with 400 and creates nothing',
    async (extra) => {
      const res = await register({ ...valid, ...extra });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.user.count()).toBe(0);
    },
  );

  it('returns 409 CONFLICT for an existing email, whatever its case', async () => {
    expect((await register(valid)).status).toBe(201);

    const res = await register({ ...valid, email: 'ALICE@example.test', displayName: 'Other' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await prisma.user.count()).toBe(1);
  });

  it('lets exactly one of two concurrent registrations of the same email succeed', async () => {
    const [first, second] = await Promise.all([register(valid), register({ ...valid, displayName: 'Twin' })]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await prisma.user.count()).toBe(1);
  });

  it.each([
    ['11 code points', 'a'.repeat(11), 400],
    ['12 code points', 'a'.repeat(12), 201],
    ['128 code points', 'a'.repeat(128), 201],
    ['129 code points', 'a'.repeat(129), 400],
    ['12 emoji (code points, not UTF-16 units)', '😀'.repeat(12), 201],
    ['11 emoji', '😀'.repeat(11), 400],
  ])('password of %s → %i', async (_label, password, status) => {
    const res = await register({ ...valid, password });
    expect(res.status).toBe(status);
  });

  it.each([
    ['blank', '   '],
    ['51 code points', 'x'.repeat(51)],
    ['control character', 'Ali\u0000ce'],
    ['not a string', 42],
  ])('rejects a %s display name', async (_label, name) => {
    const res = await register({ ...valid, displayName: name });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a 50 code point display name', async () => {
    expect((await register({ ...valid, displayName: 'é'.repeat(50) })).status).toBe(201);
  });

  it.each(['not-an-email', '', `${'a'.repeat(250)}@x.io`])('rejects email %j', async (address) => {
    const res = await register({ ...valid, email: address });
    expect(res.status).toBe(400);
  });

  it('rejects a missing field without echoing the password', async () => {
    const res = await register({ email: valid.email, password: PASSWORD });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });
});
