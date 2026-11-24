import { z } from 'zod';
import { AppError } from '../middlewares/errors.js';

/**
 * Cursor pagination (docs/backend/api-conventions.md).
 *
 * A cursor is base64url-encoded JSON describing the position after the last item
 * returned. Clients treat it as opaque. It is not a secret and not a permission:
 * the server re-validates its content with a schema and every query keeps its own
 * owner/visibility filters, so a forged cursor can only move the position inside
 * data the caller may already see.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
/** Upper bound on the encoded cursor length, checked before any decoding. */
export const MAX_CURSOR_LENGTH = 512;

/** Query fields shared by paginated routes; spread into a route's query schema. */
export const paginationQueryShape = {
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
};

export const paginationQuerySchema = z.strictObject(paginationQueryShape);

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function encodeCursor(position: unknown): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_ERROR', {
    details: [{ location: 'query', path: 'cursor', code: 'invalid_value', message: 'Invalid value.' }],
  });
}

/**
 * Decodes a cursor and validates its content with `schema`.
 * Any malformed, non-canonical or schema-invalid cursor throws 400 VALIDATION_ERROR.
 */
export function decodeCursor<S extends z.ZodType>(cursor: string, schema: S): z.output<S> {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !BASE64URL.test(cursor)) {
    throw invalidCursor();
  }
  const buffer = Buffer.from(cursor, 'base64url');
  // Node ignores trailing garbage bits; require the canonical encoding.
  if (buffer.toString('base64url') !== cursor) throw invalidCursor();

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  const result = schema.safeParse(parsed);
  if (!result.success) throw invalidCursor();
  return result.data;
}

/**
 * Builds a page from rows fetched with `take: limit + 1`. The extra row only
 * signals that another page exists; it is never returned.
 */
export function buildPage<Row, Item>(
  rows: readonly Row[],
  limit: number,
  toItem: (row: Row) => Item,
  toPosition: (row: Row) => unknown,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const nextCursor = rows.length > limit && last !== undefined ? encodeCursor(toPosition(last)) : null;
  return { items: pageRows.map(toItem), nextCursor };
}
