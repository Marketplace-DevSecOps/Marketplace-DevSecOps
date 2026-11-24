import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getValidated, validate } from '../../src/middlewares/validate.js';
import { buildTestApp } from '../helpers/testApp.js';

const itemSchemas = {
  params: z.object({ id: z.uuid() }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['newest', 'price_asc']).optional(),
  }),
  body: z.object({ title: z.string().min(3).max(80), price: z.number().nonnegative() }),
};

const ID = '6f1c3f0e-8d2a-4b6e-9a1d-2f3b4c5d6e7f';

describe('validate middleware', () => {
  const { app } = buildTestApp({
    extendApiRouter: (router) => {
      router.post('/__test/items/:id', validate(itemSchemas), (req, res) => {
        const { params, query, body } = getValidated(req, itemSchemas);
        res.json({ params, query, body, rawQuery: req.query });
      });
      router.get(
        '/__test/search',
        validate({ query: itemSchemas.query }),
        (req, res) => {
          res.json(getValidated(req, { query: itemSchemas.query }));
        },
      );
    },
  });

  it('passes parsed params, query and body to the handler', async () => {
    const res = await request(app)
      .post(`/api/v1/__test/items/${ID}?limit=5&sort=newest`)
      .send({ title: 'Bike', price: 120 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      params: { id: ID },
      query: { limit: 5, sort: 'newest' },
      body: { title: 'Bike', price: 120 },
      rawQuery: { limit: '5', sort: 'newest' },
    });
  });

  it('applies query defaults and coercion without overwriting req.query (Express 5 getter)', async () => {
    const res = await request(app).get('/api/v1/__test/search');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ query: { limit: 20 } });
  });

  it('rejects an invalid param with 400 VALIDATION_ERROR and a field detail', async () => {
    const res = await request(app).post('/api/v1/__test/items/not-a-uuid').send({ title: 'Bike', price: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
        correlationId: res.headers['x-request-id'],
        details: [{ location: 'params', path: 'id', code: 'invalid_format', message: 'Invalid format.' }],
      },
    });
  });

  it('rejects out-of-range query values', async () => {
    const res = await request(app).get('/api/v1/__test/search?limit=1000');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { location: 'query', path: 'limit', code: 'too_big', message: 'Value is too large or too long.' },
    ]);
  });

  it('rejects a repeated query parameter (array instead of scalar)', async () => {
    const res = await request(app).get('/api/v1/__test/search?sort=newest&sort=price_asc');

    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: 'query', path: 'sort' });
  });

  it.each([
    ['query', '/api/v1/__test/search?limit=5&role=ADMIN'],
    ['body', `/api/v1/__test/items/${ID}`],
  ])('rejects unknown fields in %s (strict schemas)', async (location, path) => {
    const res =
      location === 'query'
        ? await request(app).get(path)
        : await request(app).post(path).send({ title: 'Bike', price: 1, ownerId: 'someone-else' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { location, path: '', code: 'unrecognized_keys', message: 'Unknown fields are not allowed.' },
    ]);
  });

  it('reports issues from several locations at once', async () => {
    const res = await request(app).post('/api/v1/__test/items/bad?limit=0').send({ title: 'x', price: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { location: string; path: string }) => `${d.location}:${d.path}`)).toEqual([
      'params:id',
      'query:limit',
      'body:title',
      'body:price',
    ]);
  });

  it('rejects a missing body as invalid_type at the root', async () => {
    const res = await request(app).post(`/api/v1/__test/items/${ID}`);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { location: 'body', path: '', code: 'invalid_type', message: 'Invalid type.' },
    ]);
  });
});
