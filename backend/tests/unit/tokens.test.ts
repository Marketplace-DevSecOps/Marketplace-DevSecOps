import { decodeJwt, decodeProtectedHeader, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/infrastructure/config.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  createAccessTokenService,
  generateRefreshToken,
  hashRefreshToken,
  InvalidTokenError,
} from '../../src/modules/auth/tokens.js';
import { TEST_ENV } from '../helpers/testApp.js';

const config = parseConfig(TEST_ENV);
const key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
const claims = { userId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222' };
const T0 = new Date('2026-01-01T00:00:00.000Z');

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A token signed with the right key but built by hand, to test each verification rule. */
function forge({ alg = 'HS256', payload = {} as Record<string, unknown>, iatOffset = 0 } = {}) {
  const nowSeconds = Math.floor(T0.getTime() / 1000);
  return new SignJWT({ sub: claims.userId, sid: claims.sessionId, ...payload })
    .setProtectedHeader({ alg })
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt(nowSeconds + iatOffset)
    .setExpirationTime(nowSeconds + 600)
    .sign(key);
}

describe('access token service', () => {
  const service = createAccessTokenService(config, () => T0);

  it('round-trips and carries only sub, sid, iss, aud, iat and exp', async () => {
    const { token, expiresAt } = await service.sign(claims);

    expect(await service.verify(token)).toEqual(claims);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const payload = decodeJwt(token);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);
    expect(payload).toMatchObject({ sub: claims.userId, sid: claims.sessionId, iss: 'marketplace-api', aud: 'marketplace-clients' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(expiresAt.getTime()).toBe(T0.getTime() + 600_000);
  });

  it('accepts the token until it expires, then rejects it', async () => {
    const { token } = await service.sign(claims);
    const at = (seconds: number) => createAccessTokenService(config, () => new Date(T0.getTime() + seconds * 1000));

    await expect(at(599).verify(token)).resolves.toEqual(claims);
    await expect(at(600).verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects a tampered payload or signature', async () => {
    const { token } = await service.sign(claims);
    const [header, , signature] = token.split('.');
    const otherPayload = base64url({ ...decodeJwt(token), sub: '33333333-3333-4333-8333-333333333333' });

    await expect(service.verify(`${header}.${otherPayload}.${signature}`)).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(service.verify(`${token.slice(0, -2)}xx`)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it.each([
    ['another issuer', { JWT_ISSUER: 'someone-else' }],
    ['another audience', { JWT_AUDIENCE: 'other-app' }],
    ['another key', { JWT_ACCESS_SECRET: 'another-test-only-secret-0123456789abcdef' }],
  ])('rejects a token checked with %s', async (_label, overrides) => {
    const { token } = await service.sign(claims);
    const other = createAccessTokenService(parseConfig({ ...TEST_ENV, ...overrides }), () => T0);

    await expect(other.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects an unsigned (alg none) token', async () => {
    const payload = decodeJwt((await service.sign(claims)).token);
    const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`;

    await expect(service.verify(unsigned)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects an algorithm outside the allowlist, even with the right key', async () => {
    await expect(service.verify(await forge({ alg: 'HS512' }))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(service.verify(await forge())).resolves.toEqual(claims);
  });

  it.each([
    ['without sid', { payload: { sid: undefined } }],
    ['with a non-string sid', { payload: { sid: 42 } }],
    ['issued more than 10 minutes ago (long-lived forged exp)', { iatOffset: -3600 }],
  ])('rejects a token %s', async (_label, options) => {
    await expect(service.verify(await forge(options))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it.each(['', 'garbage', 'a.b.c'])('rejects malformed input %j', async (token) => {
    await expect(service.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe('refresh tokens', () => {
  it('are 32 random bytes in base64url (43 characters) and never repeat', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateRefreshToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('hash to a deterministic 64-character SHA-256 hex digest', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toBe(hashRefreshToken(generateRefreshToken()));
    expect(hashRefreshToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
