import { toCurrentUserDto, type CurrentUserDto } from '../../contracts/dto.js';
import { AppError } from '../../middlewares/errors.js';
import type { AuthRepository } from './auth.repository.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import type { PasswordHasher } from './password.js';
import type { SessionsService } from './sessions.service.js';
import { ACCESS_TOKEN_TTL_SECONDS, type AccessTokenService } from './tokens.js';

/** A new session, before the controller picks the transport (cookie or body). */
export interface LoginResult {
  user: CurrentUserDto;
  sessionId: string;
  /** Rotation family; the Web CSRF token is bound to it. */
  familyId: string;
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  /** Plaintext refresh token: sent to the client once, never stored or logged. */
  refreshToken: string;
}

/** A rotated session (API-03). */
export interface RefreshResult {
  userId: string;
  sessionId: string;
  familyId: string;
  /** Absolute family expiry, inherited from the login. */
  expiresAt: Date;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export interface AuthService {
  register(input: RegisterInput): Promise<CurrentUserDto>;
  /**
   * Web and mobile login (API-02). Unknown email, wrong password and disabled
   * account all throw the same AppError('INVALID_CREDENTIALS') after one Argon2
   * verification each, so neither the body nor the timing tells them apart.
   */
  login(input: LoginInput): Promise<LoginResult>;
  /** Session family of a refresh token (any state), or null when unknown. */
  findFamily(refreshToken: string): Promise<string | null>;
  /** Rotates the refresh token (sessions.service rules: 409 in the grace window, 401 otherwise). */
  refresh(refreshToken: string): Promise<RefreshResult>;
  /** Revokes the whole family (idempotent). */
  revokeFamily(familyId: string): Promise<void>;
  /** Mobile logout: revokes the family of the token if it is known; never fails for an unknown token. */
  logout(refreshToken: string): Promise<void>;
}

export interface AuthServiceDependencies {
  sessions: Pick<SessionsService, 'createSession' | 'rotate' | 'findByRefreshToken' | 'revokeFamily'>;
  tokens: Pick<AccessTokenService, 'sign'>;
}

export function createAuthService(
  repository: AuthRepository,
  passwords: PasswordHasher,
  { sessions, tokens }: AuthServiceDependencies,
): AuthService {
  return {
    async register({ email, displayName, password }) {
      const passwordHash = await passwords.hash(password);
      const row = await repository.createUser({ email, displayName, passwordHash });
      return toCurrentUserDto(row);
    },

    async login({ email, password }) {
      const row = await repository.findCredentialsByEmail(email);
      if (row === null) {
        await passwords.verifyDummy(password);
        throw new AppError('INVALID_CREDENTIALS');
      }
      // The real hash is verified even for a disabled account (same cost).
      const valid = await passwords.verify(row.passwordHash, password);
      if (!valid || row.status !== 'ACTIVE') throw new AppError('INVALID_CREDENTIALS');

      if (passwords.needsRehash(row.passwordHash)) {
        // Best effort: a failed upgrade never fails the login.
        try {
          await repository.updatePasswordHash(row.id, row.passwordHash, await passwords.hash(password));
        } catch {
          // Ignored on purpose; the old hash stays valid.
        }
      }

      const { session, refreshToken } = await sessions.createSession(row.id);
      const { token } = await tokens.sign({ userId: row.id, sessionId: session.id });
      return {
        user: toCurrentUserDto(row),
        sessionId: session.id,
        familyId: session.familyId,
        accessToken: token,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken,
      };
    },

    async findFamily(refreshToken) {
      return (await sessions.findByRefreshToken(refreshToken))?.familyId ?? null;
    },

    async refresh(refreshToken) {
      const { session, refreshToken: next } = await sessions.rotate(refreshToken);
      const { token } = await tokens.sign({ userId: session.userId, sessionId: session.id });
      return {
        userId: session.userId,
        sessionId: session.id,
        familyId: session.familyId,
        expiresAt: session.expiresAt,
        accessToken: token,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: next,
      };
    },

    async revokeFamily(familyId) {
      await sessions.revokeFamily(familyId);
    },

    async logout(refreshToken) {
      const session = await sessions.findByRefreshToken(refreshToken);
      if (session !== null) await sessions.revokeFamily(session.familyId);
    },
  };
}
