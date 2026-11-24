import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const CORRELATION_HEADER = 'X-Request-Id';

/** Incoming ids are accepted only if they are short and limited to safe characters. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
  }
}

export function correlationId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(CORRELATION_HEADER);
    const id = incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    req.correlationId = id;
    res.setHeader(CORRELATION_HEADER, id);
    next();
  };
}
