import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UserRole } from '../../../common/enums.js';
import { AccessTokenPayload, AuthContext } from '../auth.types.js';
import { IS_PUBLIC_KEY } from '../decorators.js';
import { TokenService } from '../token.service.js';

const ROLES = new Set<string>(Object.values(UserRole));

function isAccessPayload(p: unknown): p is AccessTokenPayload {
  const v = p as Partial<AccessTokenPayload> | null;
  return (
    typeof v?.sub === 'string' &&
    typeof v.sid === 'string' &&
    v.typ === 'access' &&
    typeof v.role === 'string' &&
    ROLES.has(v.role)
  );
}

/**
 * Global guard: every HTTP route needs a valid, non-revoked access token unless
 * marked @Public(). Socket.IO connections authenticate at handshake (added with
 * the first realtime feature), so non-HTTP contexts are not handled here.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Sign in to continue.');
    }

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
    if (!isAccessPayload(payload) || (await this.tokens.isSessionRevoked(payload.sid))) {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    request.auth = { userId: payload.sub, role: payload.role, sessionId: payload.sid };
    return true;
  }
}
