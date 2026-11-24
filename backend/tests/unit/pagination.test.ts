import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildPage,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  encodeCursor,
  MAX_CURSOR_LENGTH,
  MAX_PAGE_LIMIT,
  paginationQuerySchema,
} from '../../src/contracts/pagination.js';
import { AppError } from '../../src/middlewares/errors.js';
import { getValidated, validate } from '../../src/middlewares/validate.js';
import { buildTestApp } from '../helpers/testApp.js';

const positionSchema = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() });
const POSITION = { createdAt: '2025-01-02T03:04:05.678Z', id: '6f1c3f0e-8d2a-4b6e-9a1d-2f3b4c5d6e7f' };

function expectInvalidCursor(cursor: string) {
  try {
    decodeCursor(cursor, positionSchema);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(400);
    expect((err as AppError).code).toBe('VALIDATION_ERROR');
    expect((err as AppError).details).toEqual([
      { location: 'query', path: 'cursor', code: 'invalid_value', message: 'Invalid value.' },
    ]);
    return;
  }
  throw new Error('expected decodeCursor to throw');
}

describe('cursor encoding', () => {
  it('round-trips a position as URL-safe base64', () => {
    const cursor = encodeCursor(POSITION);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, positionSchema)).toEqual(POSITION);
  });

  it.each([
    ['non base64url characters', 'abc+/='],
    ['non-canonical trailing bits', `${encodeCursor(POSITION).slice(0, -1)}_`],
    ['valid base64url but not JSON', Buffer.from('not json').toString('base64url')],
    ['JSON failing the position schema', encodeCursor({ createdAt: 'yesterday', id: 1 })],
    ['JSON with extra fields', encodeCursor({ ...POSITION, sellerId: 'x' })],
    ['an over-long cursor', 'A'.repeat(MAX_CURSOR_LENGTH + 1)],
    ['an empty cursor', ''],
  ])('rejects %s with 400 VALIDATION_ERROR', (_label, cursor) => {
    expectInvalidCursor(cursor);
  });
});

describe('paginationQuerySchema', () => {
  it('defaults the limit to 20', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_LIMIT });
    expect(DEFAULT_PAGE_LIMIT).toBe(20);
  });

  it('accepts 1 to 100 and rejects anything else', () => {
    expect(MAX_PAGE_LIMIT).toBe(100);
    expect(paginationQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(paginationQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    for (const limit of ['0', '101', '-1', '2.5', 'abc']) {
      expect(paginationQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });
});

describe('buildPage', () => {
  const rows = [1, 2, 3].map((n) => ({ n, secret: 's' }));

  it('returns limit items and a cursor to the last one when more rows exist', () => {
    const page = buildPage(rows, 2, (r) => ({ n: r.n }), (r) => ({ n: r.n }));

    expect(page.items).toEqual([{ n: 1 }, { n: 2 }]);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor ?? '', z.strictObject({ n: z.number() }))).toEqual({ n: 2 });
  });

  it('returns a null cursor on the last page', () => {
    expect(buildPage(rows, 3, (r) => r.n, (r) => r.n)).toEqual({ items: [1, 2, 3], nextCursor: null });
    expect(buildPage([], 20, (r: number) => r, (r) => r)).toEqual({ items: [], nextCursor: null });
  });
});

describe('invalid cursor over HTTP', () => {
  const { app } = buildTestApp({
    extendApiRouter: (router) => {
      router.get('/__test/page', validate({ query: paginationQuerySchema }), (req, res) => {
        const { query } = getValidated(req, { query: paginationQuerySchema });
        const position = query.cursor === undefined ? null : decodeCursor(query.cursor, positionSchema);
        res.json({ limit: query.limit, position });
      });
    },
  });

  it('accepts a valid cursor and the default limit', async () => {
    const res = await request(app).get(`/api/v1/__test/page?cursor=${encodeCursor(POSITION)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ limit: 20, position: POSITION });
  });

  it('answers 400 VALIDATION_ERROR for a forged cursor without echoing it', async () => {
    const forged = Buffer.from('{"id":"<script>"}').toString('base64url');
    const res = await request(app).get(`/api/v1/__test/page?cursor=${forged}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { location: 'query', path: 'cursor', code: 'invalid_value', message: 'Invalid value.' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(forged);
    expect(JSON.stringify(res.body)).not.toContain('script');
  });
});
