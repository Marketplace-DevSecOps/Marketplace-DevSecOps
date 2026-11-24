import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';
import { AppError, type FieldIssue } from './errors.js';

export type ValidationLocation = FieldIssue['location'];

/**
 * Schemas for the parts of a request. Each top-level schema is made strict by the
 * middleware, so unknown fields are rejected. Nested objects must be declared with
 * `z.strictObject(...)` (or `.strict()`) to get the same behaviour.
 */
export interface ValidationSchemas {
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodObject;
}

export type Validated<S extends ValidationSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * Parsed request input. Express 5 exposes `req.query` as a getter, so parsed
     * values are stored here instead of overwriting `req.query`/`req.params`/`req.body`.
     */
    validated?: Partial<Record<ValidationLocation, unknown>>;
  }
}

const LOCATIONS: readonly ValidationLocation[] = ['params', 'query', 'body'];

/** Upper bound on the number of details returned, to keep error bodies small. */
const MAX_DETAILS = 20;

/** Fixed messages per Zod issue code: Zod's own messages may quote received values. */
const ISSUE_MESSAGES: Record<string, string> = {
  invalid_type: 'Invalid type.',
  too_small: 'Value is too small or too short.',
  too_big: 'Value is too large or too long.',
  invalid_format: 'Invalid format.',
  not_multiple_of: 'Invalid number.',
  unrecognized_keys: 'Unknown fields are not allowed.',
  invalid_union: 'Invalid value.',
  invalid_key: 'Invalid key.',
  invalid_element: 'Invalid element.',
  invalid_value: 'Invalid value.',
  custom: 'Invalid value.',
};

/** Path segments come from the schema, except record keys; anything unusual is masked. */
const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,64}$/;

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => {
      if (typeof segment === 'number') return String(segment);
      if (typeof segment === 'string' && SAFE_SEGMENT.test(segment)) return segment;
      return '*';
    })
    .join('.');
}

export function toFieldIssues(location: ValidationLocation, error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => {
    const code = issue.code in ISSUE_MESSAGES ? issue.code : 'invalid_value';
    return {
      location,
      path: formatPath(issue.path),
      code,
      message: ISSUE_MESSAGES[code] ?? 'Invalid value.',
    };
  });
}

/** Validates params, query and body; responds 400 VALIDATION_ERROR with neutral details. */
export function validate(schemas: ValidationSchemas): RequestHandler {
  const strictSchemas = LOCATIONS.flatMap((location) => {
    const schema = schemas[location];
    return schema === undefined ? [] : [[location, schema.strict()] as const];
  });

  return (req, _res, next) => {
    const validated: Partial<Record<ValidationLocation, unknown>> = {};
    const details: FieldIssue[] = [];

    for (const [location, schema] of strictSchemas) {
      const result = schema.safeParse(req[location]);
      if (result.success) {
        validated[location] = result.data;
      } else {
        details.push(...toFieldIssues(location, result.error));
      }
    }

    if (details.length > 0) {
      next(new AppError('VALIDATION_ERROR', { details: details.slice(0, MAX_DETAILS) }));
      return;
    }

    req.validated = validated;
    next();
  };
}

/** Typed access to the values parsed by `validate(schemas)` for the same schemas. */
export function getValidated<S extends ValidationSchemas>(req: Request, _schemas: S): Validated<S> {
  if (req.validated === undefined) {
    throw new Error('getValidated called on a route without the validate middleware');
  }
  return req.validated as Validated<S>;
}
