import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { User } from './entities/user.entity.js';

export interface ContactChanges {
  fullName?: string;
  email?: string | null;
}

const isUniqueViolation = (err: unknown, constraint: string) =>
  err instanceof QueryFailedError &&
  (err.driverError as { code?: string; constraint?: string }).code === '23505' &&
  (err.driverError as { constraint?: string }).constraint === constraint;

@Injectable()
export class UsersService {
  /** Applies name/email changes inside the caller's transaction. */
  async updateContact(em: EntityManager, userId: string, changes: ContactChanges): Promise<User> {
    const patch: Partial<User> = {};
    if (changes.fullName !== undefined) patch.fullName = changes.fullName;
    if (changes.email !== undefined) patch.email = changes.email;

    if (Object.keys(patch).length > 0) {
      try {
        await em.update(User, userId, patch);
      } catch (err) {
        if (isUniqueViolation(err, 'uq_users_email')) {
          throw new ConflictException('This email is already used by another account.');
        }
        throw err;
      }
    }
    const user = await em.findOneBy(User, { id: userId });
    if (!user) throw new NotFoundException('Account not found.');
    return user;
  }
}

export { isUniqueViolation };
