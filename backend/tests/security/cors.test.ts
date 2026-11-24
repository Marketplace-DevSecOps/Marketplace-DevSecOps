import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN, buildTestApp } from '../helpers/testApp.js';

describe('CORS allowlist', () => {
  const { app } = buildTestApp();

  it('echoes an allowed origin with credentials', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', ALLOWED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['vary']).toMatch(/Origin/);
  });

  it('answers a preflight from an allowed origin', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it.each(['https://evil.example.com', 'null', `${ALLOWED_ORIGIN}.evil.com`])(
    'rejects disallowed origin %s with 403 CORS_FORBIDDEN and no CORS headers',
    async (origin) => {
      const res = await request(app).get('/api/v1/health').set('Origin', origin);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CORS_FORBIDDEN');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    },
  );

  it('rejects a preflight from a disallowed origin', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves requests without an Origin header and without CORS headers', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
