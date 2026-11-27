import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/middlewares/errors.js';
import type { AuthRepository, CredentialsRow } from '../../src/modules/auth/auth.repository.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import type { PasswordHasher } from '../../src/modules/auth/password.js';

const ROW: CredentialsRow = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'alice@example.test',
  displayName: 'Alice',
  role: 'USER',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  passwordHash: '$argon2id$stored',
  status: 'ACTIVE',
};

function setup(row: CredentialsRow | null, { valid = true, rehash = false } = {}) {
  const passwords = {
    hash: vi.fn(async () => '$argon2id$new'),
    verify: vi.fn(async () => valid),
    needsRehash: vi.fn(() => rehash),
    verifyDummy: vi.fn(async () => false as const),
  } satisfies PasswordHasher;
  const repository = {
    createUser: vi.fn(),
    findCredentialsByEmail: vi.fn(async () => row),
    updatePasswordHash: vi.fn(async () => undefined),
  } satisfies AuthRepository;
  const sessions = {
    createSession: vi.fn(async () => ({
      session: {
        id: '22222222-2222-4222-8222-222222222222',
        userId: ROW.id,
        familyId: '33333333-3333-4333-8333-333333333333',
        expiresAt: new Date(),
        revokedAt: null,
        usedAt: null,
      },
      refreshToken: 'refresh-token',
    })),
  };
  const tokens = { sign: vi.fn(async () => ({ token: 'access-token', expiresAt: new Date() })) };
  const service = createAuthService(repository, passwords, { sessions, tokens });
  return { service, passwords, repository, sessions };
}

async function expectInvalidCredentials(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('INVALID_CREDENTIALS');
}

const input = { email: ROW.email, password: 'whatever-password' };

describe('auth service login', () => {
  it('unknown email: verifies against the dummy hash once, then fails', async () => {
    const { service, passwords, sessions } = setup(null);
    await expectInvalidCredentials(service.login(input));
    expect(passwords.verifyDummy).toHaveBeenCalledTimes(1);
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('disabled account: verifies the real hash once, then fails even with the right password', async () => {
    const { service, passwords, sessions } = setup({ ...ROW, status: 'DISABLED' });
    await expectInvalidCredentials(service.login(input));
    expect(passwords.verify).toHaveBeenCalledTimes(1);
    expect(passwords.verifyDummy).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('wrong password: one verification, same error', async () => {
    const { service, passwords } = setup(ROW, { valid: false });
    await expectInvalidCredentials(service.login(input));
    expect(passwords.verify).toHaveBeenCalledTimes(1);
  });

  it('success: opens a session and returns the DTO without the hash', async () => {
    const { service, sessions } = setup(ROW);
    const result = await service.login(input);
    expect(sessions.createSession).toHaveBeenCalledWith(ROW.id);
    expect(result).toEqual({
      user: { id: ROW.id, email: ROW.email, displayName: ROW.displayName, role: 'USER', createdAt: '2026-01-01T00:00:00.000Z' },
      sessionId: '22222222-2222-4222-8222-222222222222',
      accessToken: 'access-token',
      expiresIn: 600,
      refreshToken: 'refresh-token',
    });
  });

  it('rehashes an outdated hash and still logs in when the update fails', async () => {
    const { service, repository } = setup(ROW, { rehash: true });
    repository.updatePasswordHash.mockRejectedValueOnce(new Error('db down'));
    await expect(service.login(input)).resolves.toMatchObject({ accessToken: 'access-token' });
    expect(repository.updatePasswordHash).toHaveBeenCalledWith(ROW.id, ROW.passwordHash, '$argon2id$new');
  });
});
