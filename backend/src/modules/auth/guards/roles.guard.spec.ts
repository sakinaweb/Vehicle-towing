import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../../common/enums.js';
import { RolesGuard } from './roles.guard.js';

function contextWith(role: UserRole | undefined, required: UserRole[] | undefined) {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const ctx = {
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ auth: role ? { userId: 'u', role, sessionId: 's' } : undefined }),
    }),
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(reflector), ctx };
}

describe('RolesGuard', () => {
  it('allows routes without @Roles', () => {
    const { guard, ctx } = contextWith(UserRole.Customer, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a matching role', () => {
    const { guard, ctx } = contextWith(UserRole.Driver, [UserRole.Driver]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('forbids other roles', () => {
    const { guard, ctx } = contextWith(UserRole.Customer, [UserRole.Driver]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('forbids when no caller is attached', () => {
    const { guard, ctx } = contextWith(undefined, [UserRole.Admin]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
