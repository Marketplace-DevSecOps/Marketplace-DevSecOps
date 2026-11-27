import { readFileSync } from 'node:fs';
import { Validator } from '@seriousme/openapi-schema-validator';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ERROR_CODES } from '../../src/contracts/errors.js';
import { buildTestApp } from '../helpers/testApp.js';

const SPEC_URL = new URL('../../src/contracts/openapi.yaml', import.meta.url);
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Operation {
  'x-api-ref'?: unknown;
  'x-status'?: unknown;
  security?: unknown;
  responses?: Record<string, unknown>;
}

type Spec = {
  servers: { url: string }[];
  paths: Record<string, Partial<Record<(typeof METHODS)[number], Operation>>>;
  components: { schemas: { ErrorCode: { enum: string[] } } };
};

function loadSpec(): Spec {
  return parse(readFileSync(SPEC_URL, 'utf8')) as Spec;
}

function operations(spec: Spec) {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => (item[method] ? [{ path, method, op: item[method] }] : [])),
  );
}

describe('OpenAPI contract (src/contracts/openapi.yaml)', () => {
  it('is a valid OpenAPI 3.1 document with resolvable $refs', async () => {
    const validator = new Validator();
    const result = await validator.validate(loadSpec() as unknown as Record<string, unknown>);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
    expect(validator.version).toBe('3.1');
    expect(() => validator.resolveRefs()).not.toThrow();
  });

  it('covers API-01 to API-14, including the mobile auth variants', () => {
    const ops = operations(loadSpec());
    const refs = new Set(ops.map(({ op }) => op['x-api-ref']));
    const expected = Array.from({ length: 14 }, (_, i) => `API-${String(i + 1).padStart(2, '0')}`);
    expect([...refs].sort()).toEqual(expected);

    const routes = ops.map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(routes).toEqual(
      expect.arrayContaining([
        'POST /auth/mobile/login',
        'POST /auth/mobile/refresh',
        'POST /auth/mobile/logout',
      ]),
    );
  });

  it('gives every operation a status, explicit security and error responses', () => {
    for (const { op } of operations(loadSpec())) {
      expect(['implemented', 'not-implemented']).toContain(op['x-status']);
      expect(Array.isArray(op.security)).toBe(true);
      expect(Object.keys(op.responses ?? {})).toContain('500');
    }
  });

  it('lists exactly the error codes of the catalogue', () => {
    expect(loadSpec().components.schemas.ErrorCode.enum).toEqual(ERROR_CODES);
  });

  it('marks as implemented only routes the app actually serves', async () => {
    const spec = loadSpec();
    const base = spec.servers[0]?.url ?? '';
    const { app } = buildTestApp();
    const implemented = operations(spec).filter(({ op }) => op['x-status'] === 'implemented');
    expect(implemented.length).toBeGreaterThan(0);
    for (const { method, path } of implemented) {
      const res = await request(app)[method](`${base}${path}`);
      expect(res.status, `${method.toUpperCase()} ${path}`).not.toBe(404);
    }
  });
});
