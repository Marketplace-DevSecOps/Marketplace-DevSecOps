import argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import {
  ARGON2_OPTIONS,
  createDummyVerifier,
  createPasswordHasher,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../src/modules/auth/password.js';

const PASSWORD = 'correct horse battery';

describe('password hashing', () => {
  it('produces an Argon2id PHC string with the configured parameters', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(hash).not.toContain(PASSWORD);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, `${PASSWORD}!`)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it.each(['', 'not-a-hash', '$argon2id$v=19$m=19456,t=2,p=1$broken'])(
    'returns false instead of throwing for malformed hash %j',
    async (hash) => {
      expect(await verifyPassword(hash, PASSWORD)).toBe(false);
    },
  );

  it('flags hashes made with outdated parameters or another algorithm', async () => {
    expect(needsRehash(await hashPassword(PASSWORD))).toBe(false);
    expect(needsRehash(await argon2.hash(PASSWORD, { ...ARGON2_OPTIONS, timeCost: 1 }))).toBe(true);
    expect(needsRehash(await argon2.hash(PASSWORD, { ...ARGON2_OPTIONS, type: argon2.argon2i }))).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });

  it('dummy verifier always returns false, even for the dummy password', async () => {
    const verifyDummy = createDummyVerifier();
    expect(await verifyDummy(PASSWORD)).toBe(false);
    expect(await verifyDummy('dummy-password-for-timing-equalization')).toBe(false);
  });

  it('dummy verifier computes its hash at creation and only verifies on use', async () => {
    const hashSpy = vi.spyOn(argon2, 'hash');
    try {
      const verifyDummy = createDummyVerifier();
      expect(hashSpy).toHaveBeenCalledTimes(1);
      await verifyDummy(PASSWORD);
      await verifyDummy(PASSWORD);
      expect(hashSpy).toHaveBeenCalledTimes(1);
    } finally {
      hashSpy.mockRestore();
    }
  });

  it('createPasswordHasher bundles the same functions', async () => {
    const hasher = createPasswordHasher();
    const hash = await hasher.hash(PASSWORD);
    expect(await hasher.verify(hash, PASSWORD)).toBe(true);
    expect(hasher.needsRehash(hash)).toBe(false);
    expect(await hasher.verifyDummy(PASSWORD)).toBe(false);
  });
});
