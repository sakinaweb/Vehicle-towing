import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../../common/enums.js';
import { AuthContext } from '../auth.types.js';
import { ROLES_KEY } from '../decorators.js';

/** Global guard (runs after JwtAuthGuard): enforces @Roles(...) when present. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const auth = context.switchToHttp().getRequest<{ auth?: AuthContext }>().auth;
    if (!auth || !required.includes(auth.role)) {
      throw new ForbiddenException('You do not have access to this resource.');
    }
    return true;
  }
}
