import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/testApp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('X-Request-Id correlation', () => {
  const { app } = buildTestApp();

  it('generates a UUID when the header is absent', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('echoes a valid incoming id in the header and in error bodies', async () => {
    const id = 'client-req_12345678';
    const res = await request(app).get('/api/v1/unknown').set('X-Request-Id', id);

    expect(res.headers['x-request-id']).toBe(id);
    expect(res.body.error.correlationId).toBe(id);
  });

  it.each([
    '<script>alert(1)</script>',
    '../../etc/passwd',
    'a'.repeat(65),
    'short',
    'id with spaces 123',
    '"; DROP TABLE users; --',
  ])('replaces an unsafe incoming id (%s) with a generated UUID', async (value) => {
    const res = await request(app).get('/api/v1/unknown').set('X-Request-Id', value);

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.body.error.correlationId).toBe(res.headers['x-request-id']);
    expect(res.text).not.toContain(value);
  });
});
