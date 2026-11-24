import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { REDACTED } from '../../src/infrastructure/logger.js';
import { buildTestApp } from '../helpers/testApp.js';

const BEARER = 'eyJhbGciOiJIUzI1NiJ9.secret-access-token';
const COOKIE = 'refresh=cookie-secret-value';
const SET_COOKIE = 'session=set-cookie-secret-value';

describe('log redaction', () => {
  it('removes authorization, cookie and set-cookie headers from request logs', async () => {
    const { app, logs } = buildTestApp({
      captureLogs: true,
      extendApiRouter: (router) => {
        router.get('/__test/cookie', (_req, res) => {
          res.setHeader('Set-Cookie', SET_COOKIE);
          res.json({ ok: true });
        });
      },
    });

    await request(app).get('/api/v1/__test/cookie').set('Authorization', `Bearer ${BEARER}`).set('Cookie', COOKIE);

    const output = logs();
    expect(output).toContain('/api/v1/__test/cookie');
    expect(output).toContain(REDACTED);
    expect(output).not.toContain(BEARER);
    expect(output).not.toContain('cookie-secret-value');
    expect(output).not.toContain('set-cookie-secret-value');
  });

  it('never logs request bodies', async () => {
    const { app, logs } = buildTestApp({
      captureLogs: true,
      extendApiRouter: (router) => {
        router.post('/__test/login', (_req, res) => {
          res.status(204).end();
        });
      },
    });

    await request(app).post('/api/v1/__test/login').send({ email: 'a@example.com', password: 'body-password-123' });

    expect(logs()).not.toContain('body-password-123');
  });

  it('redacts password, token and refreshToken fields in explicit log calls', () => {
    const { logger, logs } = buildTestApp({ captureLogs: true });

    logger.info(
      { password: 'pw-1', token: 'tk-1', refreshToken: 'rt-1', user: { password: 'pw-2', refreshToken: 'rt-2' } },
      'auth event',
    );

    const output = logs();
    expect(output).toContain('auth event');
    for (const secret of ['pw-1', 'tk-1', 'rt-1', 'pw-2', 'rt-2']) {
      expect(output).not.toContain(secret);
    }
  });
});
