import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/testApp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function expectErrorShape(body: unknown, code: string): void {
  expect(body).toEqual({
    error: { code, message: expect.any(String), correlationId: expect.stringMatching(UUID) },
  });
}

describe('error handling', () => {
  const { app } = buildTestApp({
    extendApiRouter: (router) => {
      router.post('/__test/echo', (req, res) => {
        res.json({ received: req.body !== undefined });
      });
    },
  });

  it('returns 404 NOT_FOUND with the error shape for an unknown route', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');
    expect(res.body.error.correlationId).toBe(res.headers['x-request-id']);
  });

  it('returns 400 MALFORMED_JSON for an invalid JSON body', async () => {
    const res = await request(app)
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');

    expect(res.status).toBe(400);
    expectErrorShape(res.body, 'MALFORMED_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|SyntaxError|position/i);
  });

  it('accepts a JSON body just under the limit', async () => {
    const res = await request(app)
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(60 * 1024) }));

    expect(res.status).toBe(200);
  });

  it('returns 413 PAYLOAD_TOO_LARGE for a body over 64kb', async () => {
    const res = await request(app)
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(65 * 1024) }));

    expect(res.status).toBe(413);
    expectErrorShape(res.body, 'PAYLOAD_TOO_LARGE');
  });
});
