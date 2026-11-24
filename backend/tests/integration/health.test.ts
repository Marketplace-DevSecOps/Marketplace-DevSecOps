import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/testApp.js';

describe('GET /api/v1/health', () => {
  it('returns 200 with a minimal body and no caching', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ status: 'ok' });
  });
});
