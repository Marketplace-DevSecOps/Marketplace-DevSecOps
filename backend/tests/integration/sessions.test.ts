import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/middlewares/errors.js';
import { createSessionEvents, type SessionRevokedEvent } from '../../src/modules/auth/session-events.js';
import { createSessionsRepository } from '../../src/modules/auth/sessions.repository.js';
import { createSessionsService, REFRESH_REUSE_GRACE_MS } from '../../src/modules/auth/sessions.service.js';
import { hashRefreshToken, REFRESH_TOKEN_TTL_MS } from '../../src/modules/auth/tokens.js';
import { createTestPrisma, truncateAll } from '../helpers/testDb.js';

const prisma = createTestPrisma();
const repository = createSessionsRepository(prisma);
const sessions = createSessionsService(repository);

async function createUser(email = 'alice@example.test') {
  return prisma.user.create({ data: { email, displayName: 'Alice', passwordHash: '$argon2id$placeholder' } });
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

function familyRows(familyId: string) {
  return prisma.session.findMany({ where: { familyId }, orderBy: { createdAt: 'asc' } });
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

describe('sessions service (refresh token rotation)', () => {
  it('createSession stores only the SHA-256 hash, with a 7-day expiry and a new family', async () => {
    const user = await createUser();
    const before = Date.now();

    const { session, refreshToken } = await sessions.createSession(user.id);

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.refreshTokenHash).toBe(hashRefreshToken(refreshToken));
    expect(row.refreshTokenHash).not.toContain(refreshToken);
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + REFRESH_TOKEN_TTL_MS);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + REFRESH_TOKEN_TTL_MS);
    const second = await sessions.createSession(user.id);
    expect(second.session.familyId).not.toBe(session.familyId);
  });

  it('rotate issues a new token in the same family and links the old row', async () => {
    const user = await createUser();
    const first = await sessions.createSession(user.id);

    const next = await sessions.rotate(first.refreshToken);

    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect(next.session.familyId).toBe(first.session.familyId);
    expect(next.session.expiresAt.getTime()).toBe(first.session.expiresAt.getTime());
    const old = await prisma.session.findUniqueOrThrow({ where: { id: first.session.id } });
    expect(old.usedAt).not.toBeNull();
    expect(old.replacedById).toBe(next.session.id);
    expect(old.revokedAt).toBeNull();
    // The successor can be rotated in turn.
    await expect(sessions.rotate(next.refreshToken)).resolves.toMatchObject({ session: { familyId: first.session.familyId } });
  });

  it('concurrent duplicate refresh: exactly one wins, the other gets 409 and the family survives', async () => {
    const user = await createUser();
    const { session, refreshToken } = await sessions.createSession(user.id);

    const results = await Promise.allSettled([sessions.rotate(refreshToken), sessions.rotate(refreshToken)]);

    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });

    const rows = await familyRows(session.familyId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.revokedAt === null)).toBe(true);
    const winner = (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof sessions.rotate>>>).value;
    await expect(sessions.rotate(winner.refreshToken)).resolves.toBeDefined();
  });

  it('a sequential replay within the grace window also gets 409 without revocation', async () => {
    const user = await createUser();
    const { session, refreshToken } = await sessions.createSession(user.id);
    await sessions.rotate(refreshToken);

    await expectAppError(sessions.rotate(refreshToken), 'CONFLICT');

    expect((await familyRows(session.familyId)).every((row) => row.revokedAt === null)).toBe(true);
  });

  it('reuse after the grace window revokes the whole family', async () => {
    const user = await createUser();
    const { session, refreshToken } = await sessions.createSession(user.id);
    const next = await sessions.rotate(refreshToken);
    await prisma.session.update({
      where: { id: session.id },
      data: { usedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000) },
    });

    await expectAppError(sessions.rotate(refreshToken), 'UNAUTHORIZED');

    const rows = await familyRows(session.familyId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
    // The legitimate holder's newest token is dead too.
    await expectAppError(sessions.rotate(next.refreshToken), 'UNAUTHORIZED');
  });

  it('a revoked token is refused and does not touch other families', async () => {
    const user = await createUser();
    const a = await sessions.createSession(user.id);
    const b = await sessions.createSession(user.id);
    expect(await sessions.revokeFamily(a.session.familyId)).toEqual([a.session.id]);

    await expectAppError(sessions.rotate(a.refreshToken), 'UNAUTHORIZED');

    const other = await prisma.session.findUniqueOrThrow({ where: { id: b.session.id } });
    expect(other.revokedAt).toBeNull();
  });

  it('revokeFamily returns only newly revoked ids', async () => {
    const user = await createUser();
    const { session, refreshToken } = await sessions.createSession(user.id);
    const next = await sessions.rotate(refreshToken);

    expect((await sessions.revokeFamily(session.familyId)).sort()).toEqual([session.id, next.session.id].sort());
    expect(await sessions.revokeFamily(session.familyId)).toEqual([]);
  });

  it('an expired token is refused without revoking the family', async () => {
    const user = await createUser();
    const { session, refreshToken } = await sessions.createSession(user.id);
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    await expectAppError(sessions.rotate(refreshToken), 'UNAUTHORIZED');

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.revokedAt).toBeNull();
    expect(row.usedAt).toBeNull();
  });

  it('a disabled user cannot rotate', async () => {
    const user = await createUser();
    const { refreshToken } = await sessions.createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });

    await expectAppError(sessions.rotate(refreshToken), 'UNAUTHORIZED');
  });

  it('an unknown token is refused', async () => {
    await expectAppError(sessions.rotate('unknown-refresh-token'), 'UNAUTHORIZED');
  });

  it('findByRefreshToken finds the row by hash only', async () => {
    const user = await createUser();
    const { session, refreshToken } = await sessions.createSession(user.id);

    expect(await sessions.findByRefreshToken(refreshToken)).toMatchObject({ id: session.id, familyId: session.familyId });
    expect(await sessions.findByRefreshToken('nope')).toBeNull();
  });
});

describe('findActiveSession (access token check)', () => {
  it('returns the user and DB role for an active session, including a rotated one', async () => {
    const user = await createUser();
    const { session, refreshToken } = await sessions.createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });

    expect(await sessions.findActiveSession(session.id, user.id)).toEqual({ userId: user.id, role: 'ADMIN' });
    await sessions.rotate(refreshToken);
    // A used (rotated) row stays valid until its access token expires.
    expect(await sessions.findActiveSession(session.id, user.id)).toEqual({ userId: user.id, role: 'ADMIN' });
  });

  it('returns null for revoked, expired, wrong-user, disabled-user and malformed ids', async () => {
    const user = await createUser();
    const other = await createUser('bob@example.test');
    const revoked = await sessions.createSession(user.id);
    await sessions.revokeFamily(revoked.session.familyId);
    const expired = await sessions.createSession(user.id);
    await prisma.session.update({ where: { id: expired.session.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    const active = await sessions.createSession(user.id);

    expect(await sessions.findActiveSession(revoked.session.id, user.id)).toBeNull();
    expect(await sessions.findActiveSession(expired.session.id, user.id)).toBeNull();
    expect(await sessions.findActiveSession(active.session.id, other.id)).toBeNull();
    expect(await sessions.findActiveSession('not-a-uuid', user.id)).toBeNull();

    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    expect(await sessions.findActiveSession(active.session.id, user.id)).toBeNull();
  });
});

describe('session revocation events (realtime hook)', () => {
  function withEvents() {
    const events = createSessionEvents();
    const received: SessionRevokedEvent[] = [];
    events.onRevoked((event) => {
      received.push(event);
    });
    return { service: createSessionsService(repository, { events }), received };
  }

  it('reuse detection emits one reuse event with every session of the family', async () => {
    const { service, received } = withEvents();
    const user = await createUser();
    const { session, refreshToken } = await service.createSession(user.id);
    const next = await service.rotate(refreshToken);
    await prisma.session.update({
      where: { id: session.id },
      data: { usedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000) },
    });

    await expectAppError(service.rotate(refreshToken), 'UNAUTHORIZED');

    expect(received).toHaveLength(1);
    expect(received[0]?.reason).toBe('reuse');
    expect(received[0]?.userId).toBe(user.id);
    expect(received[0]?.familyId).toBe(session.familyId);
    expect([...(received[0]?.sessionIds ?? [])].sort()).toEqual([session.id, next.session.id].sort());
  });

  it('revokeFamily emits logout by default, and nothing when the family is already revoked', async () => {
    const { service, received } = withEvents();
    const user = await createUser();
    const { session } = await service.createSession(user.id);

    await service.revokeFamily(session.familyId);
    await service.revokeFamily(session.familyId);

    expect(received).toEqual([{ userId: user.id, familyId: session.familyId, sessionIds: [session.id], reason: 'logout' }]);
  });

  it('a duplicate within the grace window emits nothing', async () => {
    const { service, received } = withEvents();
    const user = await createUser();
    const { refreshToken } = await service.createSession(user.id);
    await service.rotate(refreshToken);
    await expectAppError(service.rotate(refreshToken), 'CONFLICT');
    expect(received).toEqual([]);
  });
});
