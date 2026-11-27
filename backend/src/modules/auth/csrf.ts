import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Header the SPA copies the mp_csrf cookie into on Web refresh and logout. */
export const CSRF_HEADER = 'X-CSRF-Token';

const NONCE_BYTES = 16;
const TOKEN_FORMAT = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

export interface CsrfTokens {
  /** `<nonce>.<HMAC-SHA256(key, familyId + "." + nonce)>`, both base64url. */
  issue(familyId: string): string;
  /** True when the token is well formed and was issued for this session family. */
  verify(token: string, familyId: string): boolean;
}

/**
 * Signed double-submit CSRF token (OWASP CSRF Prevention Cheat Sheet). The value
 * lives in a readable cookie and must be echoed in X-CSRF-Token; a cross-site
 * page can neither read the cookie nor forge the HMAC. Binding it to the
 * session family means a token planted from another login is refused.
 * The key is derived from JWT_ACCESS_SECRET with HKDF (separate purpose label),
 * so no extra secret has to be configured.
 */
export function createCsrfTokens(secret: string): CsrfTokens {
  const key = Buffer.from(hkdfSync('sha256', secret, '', 'mp-csrf-v1', 32));
  const mac = (familyId: string, nonce: string) =>
    createHmac('sha256', key).update(`${familyId}.${nonce}`, 'utf8').digest('base64url');
  return {
    issue(familyId) {
      const nonce = randomBytes(NONCE_BYTES).toString('base64url');
      return `${nonce}.${mac(familyId, nonce)}`;
    },
    verify(token, familyId) {
      const match = TOKEN_FORMAT.exec(token);
      if (match?.[1] === undefined || match[2] === undefined) return false;
      const expected = Buffer.from(mac(familyId, match[1]), 'utf8');
      const received = Buffer.from(match[2], 'utf8');
      return expected.length === received.length && timingSafeEqual(expected, received);
    },
  };
}

/** Constant-time equality of the header and cookie copies. */
export function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
