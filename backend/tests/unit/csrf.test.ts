import { describe, expect, it } from 'vitest';
import { createCsrfTokens, sameToken } from '../../src/modules/auth/csrf.js';

const SECRET = 'test-only-access-secret-0123456789abcdef';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const OTHER_FAMILY = '44444444-4444-4444-8444-444444444444';

describe('CSRF tokens (signed double submit)', () => {
  const csrf = createCsrfTokens(SECRET);

  it('issues nonce.hmac tokens that verify for their family only', () => {
    const token = csrf.issue(FAMILY);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(csrf.verify(token, FAMILY)).toBe(true);
    expect(csrf.verify(token, OTHER_FAMILY)).toBe(false);
  });

  it('uses a fresh nonce per token', () => {
    expect(csrf.issue(FAMILY)).not.toBe(csrf.issue(FAMILY));
  });

  it('refuses tampered, malformed and foreign-key tokens', () => {
    const token = csrf.issue(FAMILY);
    const [nonce = '', mac = ''] = token.split('.');
    const flipped = `${nonce}.${mac.startsWith('A') ? 'B' : 'A'}${mac.slice(1)}`;
    expect(csrf.verify(flipped, FAMILY)).toBe(false);
    expect(csrf.verify(`${nonce}.`, FAMILY)).toBe(false);
    expect(csrf.verify('', FAMILY)).toBe(false);
    expect(csrf.verify(`${token}.extra`, FAMILY)).toBe(false);
    expect(createCsrfTokens(`${SECRET}-other`).verify(token, FAMILY)).toBe(false);
  });

  it('sameToken compares exactly', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abd')).toBe(false);
    expect(sameToken('abc', 'abcd')).toBe(false);
  });
});
