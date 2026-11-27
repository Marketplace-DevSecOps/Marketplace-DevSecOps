import argon2 from 'argon2';

/**
 * Argon2id with the first OWASP Password Storage Cheat Sheet configuration
 * (m=19 MiB, t=2, p=1). Rationale and measured timings:
 * docs/backend/session-policy.md ("Password storage").
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const ARGON2ID_PREFIX = '$argon2id$';

// Random throwaway value: the dummy hash only has to cost the same to verify.
const DUMMY_PASSWORD = 'dummy-password-for-timing-equalization';

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** False (never throws) when the password does not match or the hash is malformed. */
  verify(hash: string, plain: string): Promise<boolean>;
  /** True when the hash was made with other parameters or another algorithm. */
  needsRehash(hash: string): boolean;
  /**
   * Spends the same work as verify() against a dummy hash and returns false.
   * Called for unknown emails so the response time does not reveal accounts.
   */
  verifyDummy(plain: string): Promise<false>;
}

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  if (!hash.startsWith(ARGON2ID_PREFIX)) return true;
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return true;
  }
}

/** Returns a verifier whose dummy hash is computed once, on first use. */
export function createDummyVerifier(): (plain: string) => Promise<false> {
  let dummyHash: Promise<string> | undefined;
  return async (plain) => {
    dummyHash ??= hashPassword(DUMMY_PASSWORD);
    await verifyPassword(await dummyHash, plain);
    return false;
  };
}

export function createPasswordHasher(): PasswordHasher {
  return {
    hash: hashPassword,
    verify: verifyPassword,
    needsRehash,
    verifyDummy: createDummyVerifier(),
  };
}
