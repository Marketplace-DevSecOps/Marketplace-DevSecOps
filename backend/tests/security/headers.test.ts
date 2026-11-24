import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/testApp.js';

describe('security headers', () => {
  const { app } = buildTestApp();

  it.each(['/api/v1/health', '/api/v1/unknown'])('sets Helmet headers and hides x-powered-by on %s', async (path) => {
    const res = await request(app).get(path);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
