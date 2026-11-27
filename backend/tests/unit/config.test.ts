import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../../src/infrastructure/config.js';
import { TEST_ENV } from '../helpers/testApp.js';

function configErrorOf(env: Record<string, string | undefined>): ConfigError {
  try {
    parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected parseConfig to throw');
}

/** Production needs a non-placeholder JWT secret. */
const PRODUCTION = { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'Zq3vN8pL2xW7cR5tY1uI9oP4aS6dF0gH' } as const;

describe('JWT settings', () => {
  it('defaults the issuer and audience', () => {
    const config = parseConfig(TEST_ENV);
    expect(config.JWT_ISSUER).toBe('marketplace-api');
    expect(config.JWT_AUDIENCE).toBe('marketplace-clients');
    expect(config.JWT_ACCESS_SECRET).toBe(TEST_ENV.JWT_ACCESS_SECRET);
  });

  it('accepts a custom issuer and audience', () => {
    const config = parseConfig({ ...TEST_ENV, JWT_ISSUER: 'iss-x', JWT_AUDIENCE: 'aud-y' });
    expect([config.JWT_ISSUER, config.JWT_AUDIENCE]).toEqual(['iss-x', 'aud-y']);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['31 characters', 'x'.repeat(31)],
  ])('rejects a %s JWT_ACCESS_SECRET without printing it', (_label, secret) => {
    const error = configErrorOf({ ...TEST_ENV, JWT_ACCESS_SECRET: secret });
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]).toMatch(/^JWT_ACCESS_SECRET /);
    if (secret) expect(error.message).not.toContain(secret);
  });

  it('accepts a 32 character secret', () => {
    expect(() => parseConfig({ ...TEST_ENV, JWT_ACCESS_SECRET: 'x'.repeat(32) })).not.toThrow();
  });

  it.each(['change-me-local-only-access-secret-0123456789', TEST_ENV.JWT_ACCESS_SECRET])(
    'rejects the placeholder %s only in production',
    (secret) => {
      expect(() => parseConfig({ ...TEST_ENV, NODE_ENV: 'development', JWT_ACCESS_SECRET: secret })).not.toThrow();
      const error = configErrorOf({ ...TEST_ENV, ...PRODUCTION, JWT_ACCESS_SECRET: secret });
      expect(error.issues).toEqual(['JWT_ACCESS_SECRET must not be a placeholder value when NODE_ENV=production']);
    },
  );
});

describe('parseConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = parseConfig({ ...TEST_ENV, CORS_ORIGINS: 'http://localhost:5173, https://app.example.com' });
    expect(config.PORT).toBe(3000);
    expect(config.BODY_LIMIT).toBe('64kb');
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
    expect(config.TRUST_PROXY).toBe(false);
  });

  it.each([
    ['false', false],
    ['true', true],
    ['1', 1],
    ['loopback, 10.0.0.0/8', ['loopback', '10.0.0.0/8']],
  ])('parses TRUST_PROXY=%s', (value, expected) => {
    expect(parseConfig({ ...TEST_ENV, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
  });

  it('rejects TRUST_PROXY=true in production', () => {
    const error = configErrorOf({ ...TEST_ENV, ...PRODUCTION, TRUST_PROXY: 'true' });
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]).toMatch(/^TRUST_PROXY /);
  });

  it.each([
    ['false', false],
    ['2', 2],
    ['10.0.0.1, 192.168.0.0/16', ['10.0.0.1', '192.168.0.0/16']],
  ])('accepts TRUST_PROXY=%s in production', (value, expected) => {
    expect(parseConfig({ ...TEST_ENV, ...PRODUCTION, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
  });

  it.each(['0.0.0.0/0', '::/0', '0.0.0.0/1,128.0.0.0/1', '10.0.0.0/7', 'loopback, 2001::/15', '4', '100'])(
    'rejects TRUST_PROXY=%s in production',
    (value) => {
      const error = configErrorOf({ ...TEST_ENV, ...PRODUCTION, TRUST_PROXY: value });
      expect(error.issues).toHaveLength(1);
      expect(error.issues[0]).toMatch(/^TRUST_PROXY /);
    },
  );

  it.each([
    ['1', 1],
    ['3', 3],
    ['10.0.0.0/8', ['10.0.0.0/8']],
    ['loopback', ['loopback']],
    ['fd00::/16', ['fd00::/16']],
  ])('accepts TRUST_PROXY=%s at the production limits', (value, expected) => {
    expect(parseConfig({ ...TEST_ENV, ...PRODUCTION, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
  });

  it.each([
    ['0.0.0.0/0', ['0.0.0.0/0']],
    ['10', 10],
  ])('still accepts TRUST_PROXY=%s outside production', (value, expected) => {
    expect(parseConfig({ ...TEST_ENV, NODE_ENV: 'development', TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
  });

  it.each(['64kb', '65536b', '16KB', '1kb'])('accepts BODY_LIMIT=%s up to 64kb', (value) => {
    expect(parseConfig({ ...TEST_ENV, BODY_LIMIT: value }).BODY_LIMIT).toBe(value);
  });

  it.each(['65kb', '65537b', '1mb', '500mb'])('rejects BODY_LIMIT=%s above 64kb', (value) => {
    const error = configErrorOf({ ...TEST_ENV, BODY_LIMIT: value });
    expect(error.issues).toEqual(['BODY_LIMIT must not exceed 64kb']);
  });

  it('rejects a malformed BODY_LIMIT with a single format issue', () => {
    expect(configErrorOf({ ...TEST_ENV, BODY_LIMIT: 'big' }).issues).toEqual(['BODY_LIMIT must be a size such as 64kb']);
  });

  it('fails when required variables are missing', () => {
    const error = configErrorOf({});
    expect(error.message).toMatch(/^Invalid configuration:/);
    expect(error.message).toContain('CORS_ORIGINS');
    expect(error.message).toContain('TRUST_PROXY');
    expect(error.message).toContain('DATABASE_URL');
  });

  it('rejects invalid values with the variable name', () => {
    const error = configErrorOf({ ...TEST_ENV, PORT: '99999', LOG_LEVEL: 'loud', TRUST_PROXY: 'yes' });
    expect(error.issues.map((issue) => issue.split(' ')[0])).toEqual(['PORT', 'LOG_LEVEL', 'TRUST_PROXY']);
  });

  it.each(['*', 'http://localhost:5173/path', 'ftp://example.com'])('rejects CORS origin %s', (origin) => {
    expect(configErrorOf({ ...TEST_ENV, CORS_ORIGINS: origin }).message).toContain('CORS_ORIGINS');
  });

  it('requires a test database separate from the main one in test mode', () => {
    expect(configErrorOf({ ...TEST_ENV, DATABASE_URL_TEST: undefined }).message).toContain('DATABASE_URL_TEST');
    expect(configErrorOf({ ...TEST_ENV, DATABASE_URL_TEST: TEST_ENV.DATABASE_URL }).message).toContain(
      'DATABASE_URL_TEST',
    );
  });

  it('never includes secret values in the error message', () => {
    const secret = 'S3cr3t-P4ssw0rd';
    const error = configErrorOf({ ...TEST_ENV, DATABASE_URL: `mysql://admin:${secret}@db.internal/app` });
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain('db.internal');
  });
});
