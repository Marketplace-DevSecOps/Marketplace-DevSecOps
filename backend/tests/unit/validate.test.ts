import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toFieldIssues } from '../../src/middlewares/validate.js';

function issuesFor(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected validation to fail');
  return toFieldIssues('body', result.error);
}

describe('toFieldIssues', () => {
  it('maps issues to location, dotted path, code and a fixed message', () => {
    const schema = z.strictObject({ user: z.strictObject({ name: z.string().min(3) }) });

    expect(issuesFor(schema, { user: { name: 'ab' } })).toEqual([
      { location: 'body', path: 'user.name', code: 'too_small', message: 'Value is too small or too short.' },
    ]);
  });

  it('keeps array indices in the path', () => {
    const schema = z.strictObject({ tags: z.array(z.string()) });

    expect(issuesFor(schema, { tags: ['ok', 42] })).toEqual([
      { location: 'body', path: 'tags.1', code: 'invalid_type', message: 'Invalid type.' },
    ]);
  });

  it('masks unusual path segments such as user-controlled record keys', () => {
    const schema = z.strictObject({ meta: z.record(z.string(), z.number()) });

    const [issue] = issuesFor(schema, { meta: { 'secret value!': 'x' } });
    expect(issue?.path).toBe('meta.*');
  });

  it('does not use custom Zod messages, which could quote input', () => {
    const schema = z.strictObject({
      code: z.string().refine(() => false, { message: 'bad code: hunter2' }),
    });

    expect(issuesFor(schema, { code: 'hunter2' })).toEqual([
      { location: 'body', path: 'code', code: 'custom', message: 'Invalid value.' },
    ]);
  });

  it('reports unknown keys at the parent path without naming them', () => {
    const schema = z.strictObject({ a: z.string() });

    expect(issuesFor(schema, { a: 'x', injected: 1 })).toEqual([
      { location: 'body', path: '', code: 'unrecognized_keys', message: 'Unknown fields are not allowed.' },
    ]);
  });
});
