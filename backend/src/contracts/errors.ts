/**
 * Catalogue of the stable error codes returned by the API.
 *
 * Clients switch on `code`, never on `message`. A code is never renamed or
 * reused for another meaning; a new situation gets a new code. Each code has a
 * fixed HTTP status and a neutral default message that reveals nothing about
 * internal state (no ids, no submitted values, no existence of private data).
 * See docs/backend/api-conventions.md.
 */
export const ERROR_CATALOGUE = {
  /** Request rejected by the HTTP layer for a reason not covered below. */
  BAD_REQUEST: { status: 400, message: 'The request could not be processed.' },
  /** Params, query or body failed schema validation (includes invalid cursors). */
  VALIDATION_ERROR: { status: 400, message: 'The request is invalid.' },
  /** The body is not parseable JSON. */
  MALFORMED_JSON: { status: 400, message: 'The request body is not valid JSON.' },
  /** No valid session: missing, expired, tampered or revoked credentials. */
  UNAUTHORIZED: { status: 401, message: 'Authentication is required.' },
  /** Authenticated but the action is not allowed (role, CSRF/Origin check). */
  FORBIDDEN: { status: 403, message: 'This action is not allowed.' },
  /** Browser origin outside the CORS allowlist. */
  CORS_FORBIDDEN: { status: 403, message: 'This origin is not allowed.' },
  /** Unknown route, or a resource that does not exist or is private to someone else. */
  NOT_FOUND: { status: 404, message: 'The requested resource was not found.' },
  /** State conflict: duplicate, stale version, idempotency key reused with other content. */
  CONFLICT: { status: 409, message: 'The request conflicts with the current state.' },
  /** Body larger than the configured limit. */
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The request body is too large.' },
  /** Body encoding or charset not supported. */
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'The request encoding is not supported.' },
  /** Quota exceeded; sent with a Retry-After header. */
  RATE_LIMITED: { status: 429, message: 'Too many requests. Try again later.' },
  /** Unexpected failure; details are logged server-side only. */
  INTERNAL_ERROR: { status: 500, message: 'An unexpected error occurred.' },
  /** A dependency (database, assistant provider) is unavailable or timed out. */
  SERVICE_UNAVAILABLE: { status: 503, message: 'The service is temporarily unavailable.' },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export const ERROR_CODES = Object.keys(ERROR_CATALOGUE) as ErrorCode[];

export function statusOf(code: ErrorCode): number {
  return ERROR_CATALOGUE[code].status;
}

/** Neutral, field-level detail of a validation failure. Never contains submitted values. */
export interface FieldIssue {
  location: 'params' | 'query' | 'body';
  path: string;
  code: string;
  message: string;
}

/** Body of every error response. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    correlationId: string;
    details?: FieldIssue[];
  };
}
