import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 254;

/** Length in Unicode code points, the unit used by the limits (and by PostgreSQL varchar). */
function codePoints(value: string): number {
  return [...value].length;
}

/** Trimmed and lowercased before the format check, so "  Alice@Example.TEST " is accepted. */
export const email = z
  .string()
  .max(320)
  .trim()
  .toLowerCase()
  .pipe(z.email().max(EMAIL_MAX_LENGTH));

const CONTROL_CHARACTERS = /\p{Cc}/u;

export const displayName = z
  .string()
  .max(DISPLAY_NAME_MAX_LENGTH * 4)
  .trim()
  .min(1)
  .refine((value) => codePoints(value) <= DISPLAY_NAME_MAX_LENGTH, { error: 'too long' })
  .refine((value) => !CONTROL_CHARACTERS.test(value), { error: 'control characters are not allowed' });

/** Never trimmed or normalized: the password is hashed exactly as typed. */
export const newPassword = z
  .string()
  .max(PASSWORD_MAX_LENGTH * 2)
  .superRefine((value, ctx) => {
    const length = codePoints(value);
    if (length < PASSWORD_MIN_LENGTH) {
      ctx.addIssue({ code: 'too_small', origin: 'string', minimum: PASSWORD_MIN_LENGTH, inclusive: true, input: value });
    } else if (length > PASSWORD_MAX_LENGTH) {
      ctx.addIssue({ code: 'too_big', origin: 'string', maximum: PASSWORD_MAX_LENGTH, inclusive: true, input: value });
    }
  });

/**
 * API-01 body. validate() makes it strict: any other field (role, status...)
 * is a 400 VALIDATION_ERROR. The role is always assigned by the server.
 */
export const registerBody = z.object({ email, displayName, password: newPassword });

export type RegisterInput = z.output<typeof registerBody>;

/** Same normalization as register, no format rule: a malformed email simply fails to log in. */
export const loginEmail = z.string().max(320).trim().toLowerCase().pipe(z.string().min(1).max(EMAIL_MAX_LENGTH));

/**
 * Login accepts 1..128 code points (not the register minimum), so a later
 * policy change never locks out existing accounts.
 */
const loginPassword = z
  .string()
  .max(PASSWORD_MAX_LENGTH * 2)
  .min(1)
  .refine((value) => codePoints(value) <= PASSWORD_MAX_LENGTH, { error: 'too long' });

/** API-02 body (Web and mobile). */
export const loginBody = z.object({ email: loginEmail, password: loginPassword });
export type LoginInput = z.output<typeof loginBody>;

/** Key used by the login quota: the same normalization as loginEmail, applied before validation. */
export function normalizeLoginEmail(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 320).trim().toLowerCase() : '';
}
