import { z } from 'zod';

// Mirrors the stable catalogue in backend/src/contracts/errors.ts. No server imports.
export const apiStatuses = {
  BAD_REQUEST: 400, VALIDATION_ERROR: 400, MALFORMED_JSON: 400,
  UNAUTHORIZED: 401, FORBIDDEN: 403, CORS_FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429, INTERNAL_ERROR: 500, SERVICE_UNAVAILABLE: 503,
} as const;
export type ApiCode = keyof typeof apiStatuses;
export type ServiceMode = 'real' | 'mock';
export type ErrorKind = 'configuration' | 'validation' | 'unauthorized' | 'forbidden'
  | 'not_found' | 'conflict' | 'rate_limited' | 'server' | 'http' | 'network'
  | 'timeout' | 'cancelled' | 'invalid_response';
export type FieldIssue = {
  location: 'body' | 'query' | 'params'; path: string; code: string; message: string;
};

const messages: Record<ErrorKind, string> = {
  configuration: 'La configuration de l’API est invalide.',
  validation: 'Certains champs sont invalides.',
  unauthorized: 'Une connexion valide est nécessaire.',
  forbidden: 'Cette action n’est pas autorisée.',
  not_found: 'Cette ressource n’est pas disponible.',
  conflict: 'La demande est en conflit avec son état actuel.',
  rate_limited: 'Trop de demandes. Respectez le délai indiqué avant de réessayer.',
  server: 'Le service est temporairement indisponible.',
  http: 'La demande n’a pas pu être traitée.',
  network: 'Le serveur est inaccessible. Vérifiez votre connexion.',
  timeout: 'Le délai de réponse est dépassé. Le résultat de l’opération peut être indéterminé.',
  cancelled: 'La demande a été annulée.',
  invalid_response: 'La réponse du serveur ne respecte pas le contrat attendu.',
};

export class ApiError extends Error {
  readonly name = 'ApiError';
  readonly kind: ErrorKind;
  readonly code: string;
  readonly status?: number;
  readonly correlationId?: string;
  readonly fields: readonly FieldIssue[];
  readonly retryAt?: number;
  readonly source: ServiceMode;

  constructor(kind: ErrorKind, options: {
    code?: string; status?: number; correlationId?: string; fields?: FieldIssue[];
    retryAt?: number; source?: ServiceMode;
  } = {}) {
    super(messages[kind]);
    this.kind = kind;
    this.code = options.code ?? kind.toUpperCase();
    this.status = options.status;
    this.correlationId = options.correlationId;
    this.fields = options.fields ?? [];
    this.retryAt = options.retryAt;
    this.source = options.source ?? 'real';
    // Deliberately no Axios config, request, raw response, original message or cause.
  }
}

export function retryDelayMs(error: ApiError, now = Date.now()): number | undefined {
  return error.retryAt === undefined ? undefined : Math.max(0, error.retryAt - now);
}

const correlation = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
const envelope = z.object({
  error: z.object({
    code: z.string().max(64), message: z.string().max(500), correlationId: correlation,
    details: z.array(z.object({
      location: z.enum(['body', 'query', 'params']),
      path: z.string().max(100), code: z.string().max(64), message: z.string().max(500),
    })).max(100).optional(),
  }),
});
const knownFields = new Set([
  '', 'email', 'displayName', 'password', 'refreshToken', 'q', 'categoryId',
  'minPrice', 'maxPrice', 'sort', 'limit', 'cursor', 'afterSeq', 'id', 'productId',
  'clientMessageId', 'body',
]);
const issueCodes = new Set(['too_small', 'too_big', 'invalid_type', 'invalid_format',
  'invalid_value', 'unrecognized_keys', 'custom']);

export function parseRetryAfter(value: unknown, now: number): number | undefined {
  if (typeof value !== 'string' || value.length > 128) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const deadline = now + Number(text) * 1000;
    return Number.isSafeInteger(deadline) && deadline <= 8.64e15 ? deadline : undefined;
  }
  // IMF-fixdate only; reject permissive Date.parse inputs such as negative numbers.
  if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return undefined;
  const deadline = Date.parse(text);
  return Number.isFinite(deadline) ? Math.max(now, deadline) : undefined;
}

export function httpError(status: number, data: unknown, headers: {
  correlationId?: unknown; retryAfter?: unknown;
}, now: number, source: ServiceMode): ApiError {
  const kind: ErrorKind = status === 400 ? 'validation' : status === 401 ? 'unauthorized'
    : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 409 ? 'conflict'
    : status === 429 ? 'rate_limited' : status >= 500 ? 'server' : 'http';
  const parsed = envelope.safeParse(data);
  const body = parsed.success ? parsed.data.error : undefined;
  const code = body?.code as ApiCode | undefined;
  const validCode = code !== undefined && Object.hasOwn(apiStatuses, code) && apiStatuses[code] === status;
  const fallback = Object.entries(apiStatuses).find(([, value]) => value === status)?.[0] ?? 'HTTP_ERROR';
  const headerId = correlation.safeParse(headers.correlationId);
  return new ApiError(kind, {
    source, status, code: validCode ? code : fallback,
    correlationId: validCode ? body?.correlationId : headerId.success ? headerId.data : undefined,
    fields: validCode && code === 'VALIDATION_ERROR' ? (body?.details ?? [])
      .filter((issue) => knownFields.has(issue.path))
      .map((issue) => ({
        location: issue.location, path: issue.path,
        code: issueCodes.has(issue.code) ? issue.code : 'invalid_value',
        message: 'Valeur invalide.',
      })) : [],
    retryAt: status === 429 || status >= 500 ? parseRetryAfter(headers.retryAfter, now) : undefined,
  });
}
