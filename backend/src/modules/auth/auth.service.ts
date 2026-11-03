import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { UserRole, UserStatus } from '../../common/enums.js';
import { maskPhone } from '../../common/phone.js';
import { AuditService } from '../audit/audit.service.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClientMeta, IssuedTokens, SelfServiceRole, SignInRole } from './auth.types.js';
import { OtpIssued, OtpService } from './otp.service.js';
import { TokenService } from './token.service.js';

const ROLE_APP: Record<SelfServiceRole, string> = {
  [UserRole.Customer]: 'a customer account — sign in from the TowNow app',
  [UserRole.Driver]: 'a driver partner account — sign in from the TowNow Partner app',
};

export interface SignInResult {
  user: User;
  isNewUser: boolean;
  tokens: IssuedTokens;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async requestOtp(phone: string, client: ClientMeta): Promise<OtpIssued> {
    const issued = await this.otp.issue(phone, client.ip);
    if (this.otp.isDemoPhone(phone)) {
      await this.audit.record({
        action: 'auth.demo_code_issued',
        entityType: 'phone',
        metadata: { phone: maskPhone(phone) },
        ip: client.ip,
        userAgent: client.userAgent,
      });
    }
    return issued;
  }

  /**
   * Verifies the code, then signs the user in — creating the account and its
   * customer/driver profile on first sign-in. The code is checked before any
   * account lookup, so the endpoint never reveals whether a number is registered.
   */
  async signInWithOtp(
    phone: string,
    code: string,
    role: SignInRole,
    client: ClientMeta,
  ): Promise<SignInResult> {
    await this.otp.verify(phone, code);

    const { user, isNewUser } = await this.dataSource.transaction(async (em) => {
      // Admin accounts are provisioned (npm run admin:create), never created by signing in.
      const created =
        role === UserRole.Admin
          ? { raw: [] }
          : await em
              .createQueryBuilder()
              .insert()
              .into(User)
              .values({ phone, role, status: UserStatus.Active })
              .orIgnore() // concurrent first sign-ins: the unique phone index decides
              .returning('id')
              .execute();
      const user = await em.findOneBy(User, { phone });
      if (!user || (role === UserRole.Admin && user.role !== UserRole.Admin)) {
        throw new ForbiddenException('This number is not registered as a TowNow admin.');
      }

      if (user.role !== role) {
        const owner = ROLE_APP[user.role as SelfServiceRole] ?? 'a staff account';
        throw new ConflictException(`This number is registered as ${owner}.`);
      }
      if (user.status !== UserStatus.Active) {
        throw new ForbiddenException('This account is not active. Contact TowNow support.');
      }

      if (role !== UserRole.Admin) await this.ensureProfile(em, user);
      const now = new Date();
      await em.update(User, user.id, {
        lastLoginAt: now,
        phoneVerifiedAt: user.phoneVerifiedAt ?? now,
      });
      return {
        user: await em.findOneByOrFail(User, { id: user.id }),
        isNewUser: (created.raw as unknown[]).length > 0,
      };
    });

    const tokens = await this.tokens.startSession(user, client);
    await this.audit.record({
      action: isNewUser ? 'auth.signed_up' : 'auth.signed_in',
      entityType: 'user',
      entityId: user.id,
      actorUserId: user.id,
      metadata: { role: user.role, method: 'sms_otp' },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { user, isNewUser, tokens };
  }

  async logout(userId: string, sessionId: string, client: ClientMeta): Promise<void> {
    await this.tokens.revokeSession(sessionId);
    await this.audit.record({
      action: 'auth.signed_out',
      entityType: 'auth_session',
      entityId: sessionId,
      actorUserId: userId,
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }

  async logoutEverywhere(userId: string, client: ClientMeta): Promise<number> {
    const ended = await this.tokens.revokeAllSessions(userId);
    await this.audit.record({
      action: 'auth.signed_out_everywhere',
      entityType: 'user',
      entityId: userId,
      actorUserId: userId,
      metadata: { sessionsEnded: ended },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return ended;
  }

  /** Every customer/driver user has exactly one profile row (unique user_id). */
  private async ensureProfile(em: EntityManager, user: User): Promise<void> {
    const profile = user.role === UserRole.Driver ? Driver : Customer;
    await em
      .createQueryBuilder()
      .insert()
      .into(profile)
      .values({ userId: user.id })
      .orIgnore()
      .execute();
  }
}
