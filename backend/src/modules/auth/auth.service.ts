import { toCurrentUserDto, type CurrentUserDto } from '../../contracts/dto.js';
import type { AuthRepository } from './auth.repository.js';
import type { RegisterInput } from './auth.schemas.js';
import type { PasswordHasher } from './password.js';

export interface AuthService {
  register(input: RegisterInput): Promise<CurrentUserDto>;
}

export function createAuthService(repository: AuthRepository, passwords: PasswordHasher): AuthService {
  return {
    async register({ email, displayName, password }) {
      const passwordHash = await passwords.hash(password);
      const row = await repository.createUser({ email, displayName, passwordHash });
      return toCurrentUserDto(row);
    },
  };
}
