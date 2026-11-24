import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'MALFORMED_JSON'
  | 'CORS_FORBIDDEN'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR';

/** Neutral, field-level detail of a validation failure. Never contains submitted values. */
export interface FieldIssue {
  location: 'params' | 'query' | 'body';
  path: string;
  code: string;
  message: string;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    correlationId: string;
    details?: FieldIssue[];
  };
}

/** An error whose code, message and details are safe to return to the client. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: FieldIssue[] | undefined;

  constructor(status: number, code: ErrorCode, message: string, details?: FieldIssue[]) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Shape of the errors raised by Express' body parser (http-errors). */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Partial<BodyParserError>).type === 'string' &&
    typeof (err as Partial<BodyParserError>).status === 'number'
  );
}

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid.');
  if (isBodyParserError(err)) {
    switch (err.type) {
      case 'entity.parse.failed':
        return new AppError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
      case 'entity.too.large':
        return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
      case 'encoding.unsupported':
      case 'charset.unsupported':
        return new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The request encoding is not supported.');
      default:
        if (err.status >= 400 && err.status < 500) {
          return new AppError(400, 'BAD_REQUEST', 'The request could not be processed.');
        }
    }
  }
  return null;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
};

/**
 * Central error handler: stable code, neutral message, correlation id.
 * Internal messages and stack traces are logged server-side only.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const known = toAppError(err);
  const appError = known ?? new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');

  if (known === null) {
    req.log.error({ err }, 'unhandled error');
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      correlationId: req.correlationId,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
  };
  res.status(appError.status).set('Cache-Control', 'no-store').json(body);
};
