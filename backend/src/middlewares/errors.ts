import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CATALOGUE, type ErrorBody, type ErrorCode, type FieldIssue } from '../contracts/errors.js';

export type { ErrorBody, ErrorCode, FieldIssue } from '../contracts/errors.js';

export interface AppErrorOptions {
  /** Overrides the catalogue message. Must stay neutral (no ids, values or internal state). */
  message?: string;
  details?: FieldIssue[];
}

/**
 * An error whose code, message and details are safe to return to the client.
 * The HTTP status always comes from the error catalogue.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: FieldIssue[] | undefined;

  constructor(code: ErrorCode, { message, details }: AppErrorOptions = {}) {
    super(message ?? ERROR_CATALOGUE[code].message);
    this.name = 'AppError';
    this.status = ERROR_CATALOGUE[code].status;
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
  if (err instanceof ZodError) return new AppError('VALIDATION_ERROR');
  if (isBodyParserError(err)) {
    switch (err.type) {
      case 'entity.parse.failed':
        return new AppError('MALFORMED_JSON');
      case 'entity.too.large':
        return new AppError('PAYLOAD_TOO_LARGE');
      case 'encoding.unsupported':
      case 'charset.unsupported':
        return new AppError('UNSUPPORTED_MEDIA_TYPE');
      default:
        if (err.status >= 400 && err.status < 500) {
          return new AppError('BAD_REQUEST');
        }
    }
  }
  return null;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND'));
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
  const appError = known ?? new AppError('INTERNAL_ERROR');

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
