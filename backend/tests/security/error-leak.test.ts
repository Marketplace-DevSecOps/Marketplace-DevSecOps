import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/testApp.js';

const INTERNAL_DETAIL = 'connection to db.internal failed with password hunter2';

describe('internal errors', () => {
  const { app } = buildTestApp({
    extendApiRouter: (router) => {
      router.get('/__test/throw', () => {
        throw new Error(INTERNAL_DETAIL);
      });
      router.get('/__test/reject', async () => {
        await Promise.resolve();
        throw new TypeError(INTERNAL_DETAIL);
      });
    },
  });

  it.each(['/api/v1/__test/throw', '/api/v1/__test/reject'])(
    'returns 500 INTERNAL_ERROR without stack or internal message (%s)',
    async (path) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          correlationId: res.headers['x-request-id'],
        },
      });
      expect(res.text).not.toContain('hunter2');
      expect(res.text).not.toContain('db.internal');
      expect(res.text).not.toMatch(/stack|Error:|\.ts:\d+|node_modules/);
    },
  );
});
