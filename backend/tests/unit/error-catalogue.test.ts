import { describe, expect, it } from 'vitest';
import { ERROR_CATALOGUE, ERROR_CODES, statusOf } from '../../src/contracts/errors.js';
import { AppError } from '../../src/middlewares/errors.js';

describe('error catalogue', () => {
  it('maps every stable code to its HTTP status', () => {
    expect(Object.fromEntries(ERROR_CODES.map((code) => [code, statusOf(code)]))).toEqual({
      BAD_REQUEST: 400,
      VALIDATION_ERROR: 400,
      MALFORMED_JSON: 400,
      UNAUTHORIZED: 401,
      INVALID_CREDENTIALS: 401,
      FORBIDDEN: 403,
      CORS_FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      PAYLOAD_TOO_LARGE: 413,
      UNSUPPORTED_MEDIA_TYPE: 415,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
      SERVICE_UNAVAILABLE: 503,
    });
  });

  it('uses upper snake case codes and non-empty neutral messages', () => {
    for (const [code, { message }] of Object.entries(ERROR_CATALOGUE)) {
      expect(code).toMatch(/^[A-Z][A-Z_]*$/);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('AppError', () => {
  it('takes status and default message from the catalogue', () => {
    const err = new AppError('CONFLICT');

    expect(err.status).toBe(409);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe(ERROR_CATALOGUE.CONFLICT.message);
    expect(err.details).toBeUndefined();
  });

  it('accepts a neutral message override and details', () => {
    const details = [{ location: 'body' as const, path: 'title', code: 'too_small', message: 'Too short.' }];
    const err = new AppError('VALIDATION_ERROR', { message: 'The listing is invalid.', details });

    expect(err.status).toBe(400);
    expect(err.message).toBe('The listing is invalid.');
    expect(err.details).toEqual(details);
  });
});
