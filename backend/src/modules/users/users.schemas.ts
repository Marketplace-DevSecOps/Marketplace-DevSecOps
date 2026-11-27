import { z } from 'zod';
import { displayName } from '../auth/auth.schemas.js';

/**
 * API-04 PATCH body: displayName only, same rules as register. validate() makes
 * it strict, so email, password, role, status or any other field is a 400.
 */
export const updateCurrentUserBody = z.object({ displayName });
export type UpdateCurrentUserInput = z.output<typeof updateCurrentUserBody>;
