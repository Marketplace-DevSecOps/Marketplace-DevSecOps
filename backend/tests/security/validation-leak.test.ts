import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../../src/middlewares/validate.js';
import { buildTestApp } from '../helpers/testApp.js';

const SECRET = 'S3cr3t-hunter2-Passw0rd';

describe('validation errors do not echo submitted values', () => {
  const { app, logs } = buildTestApp({
    captureLogs: true,
    extendApiRouter: (router) => {
      router.post(
        '/__test/register',
        validate({
          body: z.object({
            email: z.email(),
            password: z.string().min(12).max(128),
            role: z.literal('USER').optional(),
          }),
        }),
        (_req, res) => {
          res.status(204).end();
        },
      );
      router.get(
        '/__test/find',
        validate({ query: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }) }),
        (_req, res) => {
          res.status(204).end();
        },
      );
    },
  });

  it('does not return a rejected password, email or injected role', async () => {
    const res = await request(app)
      .post('/api/v1/__test/register')
      .send({ email: `${SECRET}@`, password: SECRET.slice(0, 8), role: 'ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.text).not.toContain(SECRET);
    expect(res.text).not.toContain(SECRET.slice(0, 8));
    expect(res.text).not.toContain('ADMIN');
  });

  it('does not return a rejected query token', async () => {
    const res = await request(app).get(`/api/v1/__test/find?token=${SECRET}`);

    expect(res.status).toBe(400);
    expect(res.text).not.toContain(SECRET);
  });

  it('does not name unknown fields, whose names are attacker-controlled', async () => {
    const res = await request(app)
      .post('/api/v1/__test/register')
      .send({ email: 'a@example.test', password: 'long-enough-password', [SECRET]: 1 });

    expect(res.status).toBe(400);
    expect(res.text).not.toContain(SECRET);
  });

  it('rejects a __proto__ key instead of merging it', async () => {
    const res = await request(app)
      .post('/api/v1/__test/register')
      .set('Content-Type', 'application/json')
      .send('{"email":"a@example.test","password":"long-enough-password","__proto__":{"role":"ADMIN"}}');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { location: 'body', path: '', code: 'unrecognized_keys', message: 'Unknown fields are not allowed.' },
    ]);
  });

  it('does not log submitted body values for validation failures', async () => {
    const before = logs().length;
    const res = await request(app).post('/api/v1/__test/register').send({ email: 'x', password: SECRET });

    expect(res.status).toBe(400);
    const written = logs().slice(before);
    expect(written).toContain('"statusCode":400');
    expect(written).not.toContain(SECRET);
  });
});
