import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { IsNull, Repository } from 'typeorm';
import { UserStatus } from '../../common/enums.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { AuditService } from '../audit/audit.service.js';
import { User } from '../users/entities/user.entity.js';
import { AccessTokenPayload, ClientMeta, IssuedTokens } from './auth.types.js';
import { AuthSession } from './entities/auth-session.entity.js';
import {
  formatRefreshToken,
  hashRefreshSecret,
  newRefreshSecret,
  parseRefreshToken,
  refreshSecretMatches,
} from './refresh-token.js';

const DAY_MS = 86_400_000;
const INVALID_SESSION = 'Your session has expired. Please sign in again.';

/**
 * Sessions and tokens.
 * - Access token: short-lived JWT (HS256) carrying user id, role and session id.
 * - Refresh token: opaque "<sessionId>.<secret>", rotated on every use. Presenting
 *   an already-rotated secret means the token was copied, so the session is revoked.
 * - Logout puts the session id on a Redis denylist for the remaining access-token
 *   lifetime, so revocation is immediate without a DB lookup per request.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Starts a new session for a freshly authenticated user. */
  async startSession(user: User, client: ClientMeta): Promise<IssuedTokens> {
    const secret = newRefreshSecret();
    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        refreshTokenHash: hashRefreshSecret(secret),
        expiresAt: this.refreshExpiry(),
        userAgent: client.userAgent?.slice(0, 255) ?? null,
        ipAddress: client.ip,
      }),
    );
    return this.tokensFor(user, session, secret);
  }

  /** Exchanges a refresh token for a new access + refresh token pair. */
  async rotate(
    refreshToken: unknown,
    client: ClientMeta,
  ): Promise<{ user: User; tokens: IssuedTokens }> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) throw new UnauthorizedException(INVALID_SESSION);

    const session = await this.sessions.findOne({
      where: { id: parsed.sessionId },
      relations: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException(INVALID_SESSION);
    }

    if (!refreshSecretMatches(parsed.secret, session.refreshTokenHash)) {
      // A rotated (old) token was replayed: assume theft and kill the session.
      await this.revokeSession(session.id);
      this.logger.warn(`Refresh token reuse detected; session ${session.id} revoked`);
      await this.audit.record({
        action: 'auth.refresh_token_reuse',
        entityType: 'auth_session',
        entityId: session.id,
        actorUserId: session.userId,
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new UnauthorizedException(INVALID_SESSION);
    }

    if (session.user.status !== UserStatus.Active) {
      await this.revokeSession(session.id);
      throw new UnauthorizedException('This account is not active. Contact TowNow support.');
    }

    const secret = newRefreshSecret();
    // Compare-and-swap on the old hash: of two concurrent refreshes, only one wins.
    const result = await this.sessions.update(
      { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: IsNull() },
      {
        refreshTokenHash: hashRefreshSecret(secret),
        expiresAt: this.refreshExpiry(),
        lastUsedAt: new Date(),
        ipAddress: client.ip,
      },
    );
    if (!result.affected) throw new UnauthorizedException(INVALID_SESSION);

    return { user: session.user, tokens: this.tokensFor(session.user, session, secret) };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sessions.update({ id: sessionId, revokedAt: IsNull() }, { revokedAt: new Date() });
    await this.denylist([sessionId]);
  }

  /** Signs the user out everywhere (e.g. lost phone). Returns how many sessions were ended. */
  async revokeAllSessions(userId: string): Promise<number> {
    const active = await this.sessions.find({
      where: { userId, revokedAt: IsNull() },
      select: { id: true },
    });
    if (active.length === 0) return 0;
    await this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    await this.denylist(active.map((s) => s.id));
    return active.length;
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(this.denylistKey(sessionId))) === 1;
  }

  private tokensFor(user: User, session: AuthSession, secret: string): IssuedTokens {
    const ttl = this.config.auth.accessTtlSeconds;
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      sid: session.id,
      typ: 'access',
    };
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: ttl }),
      accessTokenExpiresAt: new Date(Date.now() + ttl * 1000),
      refreshToken: formatRefreshToken(session.id, secret),
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  private async denylist(sessionIds: string[]): Promise<void> {
    // Access tokens die on their own after their TTL; deny until then (+ clock-skew margin).
    const ttl = this.config.auth.accessTtlSeconds + 60;
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds) pipeline.set(this.denylistKey(id), '1', 'EX', ttl);
    await pipeline.exec();
  }

  private denylistKey(sessionId: string): string {
    return `auth:revoked-session:${sessionId}`;
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.auth.refreshTtlDays * DAY_MS);
  }
}
