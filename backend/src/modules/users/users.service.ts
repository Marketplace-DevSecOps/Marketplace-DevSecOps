import { toCurrentUserDto, type CurrentUserDto } from '../../contracts/dto.js';
import { AppError } from '../../middlewares/errors.js';
import type { UsersRepository } from './users.repository.js';
import type { UpdateCurrentUserInput } from './users.schemas.js';

export interface UsersService {
  getCurrent(userId: string): Promise<CurrentUserDto>;
  updateCurrent(userId: string, input: UpdateCurrentUserInput): Promise<CurrentUserDto>;
}

/** The user id always comes from the session (req.auth), never from the request. */
export function createUsersService(repository: UsersRepository): UsersService {
  return {
    async getCurrent(userId) {
      const row = await repository.findById(userId);
      // Deleted between the session check and this read: treat as signed out.
      if (row === null) throw new AppError('UNAUTHORIZED');
      return toCurrentUserDto(row);
    },
    async updateCurrent(userId, { displayName }) {
      const row = await repository.updateDisplayName(userId, displayName);
      if (row === null) throw new AppError('UNAUTHORIZED');
      return toCurrentUserDto(row);
    },
  };
}
