import { isIP } from 'node:net';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const NAMED_PROXY_SUBNETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

export type TrustProxy = boolean | number | string[];

// The spec fixes the general JSON limit at 64 KiB; env may only lower it.
const MAX_BODY_LIMIT_BYTES = 64 * 1024;
const BODY_LIMIT_PATTERN = /^(\d+)(b|kb|mb)$/i;
const SIZE_UNIT_BYTES: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024 };

function bodyLimitBytes(value: string): number {
  const match = BODY_LIMIT_PATTERN.exec(value);
  // Malformed values are reported by the format check only.
  if (match === null) return 0;
  const [, amount = '', unit = ''] = match;
  return Number(amount) * (SIZE_UNIT_BYTES[unit.toLowerCase()] ?? Number.POSITIVE_INFINITY);
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // An origin has no path, query or fragment: the serialized origin must match exactly.
    return url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

function isTrustedProxyEntry(entry: string): boolean {
  if (NAMED_PROXY_SUBNETS.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  if (address === undefined || rest.length > 0) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

const corsOrigins = z
  .string({ error: 'is required (comma-separated list of origins, may be empty)' })
  .transform((raw, ctx) => {
    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const origins: string[] = [];
    for (const entry of entries) {
      const origin = parseOrigin(entry);
      if (origin === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'each entry must be an exact http(s) origin such as https://app.example.com (wildcards are not allowed)',
        });
        return z.NEVER;
      }
      origins.push(origin);
    }
    return origins;
  });

const trustProxy = z
  .string({ error: 'is required (false, true, a hop count, or a comma-separated list of addresses/subnets)' })
  .transform((raw, ctx): TrustProxy => {
    const value = raw.trim();
    if (value === 'false') return false;
    if (value === 'true') return true;
    if (/^\d+$/.test(value)) return Number(value);
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0 || !entries.every(isTrustedProxyEntry)) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be false, true, a hop count, or a comma-separated list of IP addresses, CIDR subnets, loopback, linklocal or uniquelocal',
      });
      return z.NEVER;
    }
    return entries;
  });

const postgresUrl = z
  .string({ error: 'is required' })
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname.length > 0;
    } catch {
      return false;
    }
  }, { error: 'must be a postgres:// or postgresql:// URL' });

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production'], { error: 'must be development, test or production' }).default('development'),
    PORT: z.coerce
      .number({ error: 'must be an integer between 1 and 65535' })
      .int({ error: 'must be an integer between 1 and 65535' })
      .min(1, { error: 'must be an integer between 1 and 65535' })
      .max(65535, { error: 'must be an integer between 1 and 65535' })
      .default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` }).default('info'),
    CORS_ORIGINS: corsOrigins,
    TRUST_PROXY: trustProxy,
    BODY_LIMIT: z
      .string()
      .trim()
      .regex(BODY_LIMIT_PATTERN, { error: 'must be a size such as 64kb' })
      .refine((value) => bodyLimitBytes(value) <= MAX_BODY_LIMIT_BYTES, { error: 'must not exceed 64kb' })
      .default('64kb'),
    DATABASE_URL: postgresUrl,
    DATABASE_URL_TEST: postgresUrl.optional(),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'test' && config.DATABASE_URL_TEST === undefined) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL_TEST'], message: 'is required when NODE_ENV=test' });
    }
    // Trusting every hop lets clients choose req.ip through X-Forwarded-For.
    if (config.NODE_ENV === 'production' && config.TRUST_PROXY === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'must not be true when NODE_ENV=production (use false, a hop count or a list of trusted addresses/subnets)',
      });
    }
    if (config.DATABASE_URL_TEST !== undefined && config.DATABASE_URL_TEST === config.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL_TEST'], message: 'must point to a database separate from DATABASE_URL' });
    }
  });

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Validates environment variables. Error messages name the offending variable
 * and the expected format, never the received value (which may be a secret).
 */
export function parseConfig(env: Record<string, string | undefined>): Config {
  // Treat empty strings as unset so that defaults apply to blank lines in .env.
  const input = Object.fromEntries(
    Object.keys(configSchema.shape).map((key) => {
      const value = env[key];
      return [key, value === '' && key !== 'CORS_ORIGINS' ? undefined : value];
    }),
  );
  const result = configSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
      return `${path} ${issue.message}`;
    });
    throw new ConfigError(issues);
  }
  return Object.freeze(result.data);
}
