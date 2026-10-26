import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { isUaeMobileE164, maskPhone } from '../../common/phone.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import {
  SMS_PROVIDER,
  SmsDeliveryError,
  type SmsProvider,
} from '../../infrastructure/sms/sms-provider.js';
import { OTP_VERIFIER, type OtpVerifier } from '../../infrastructure/sms/twilio-verify.client.js';
import { OtpChallenge } from './entities/otp-challenge.entity.js';
import { generateOtpCode, hashOtp, otpMatches } from './otp.crypto.js';

export interface OtpIssued {
  expiresAt: Date;
  resendAvailableAt: Date;
}

const HOUR_SECONDS = 3600;

/** 429 with a Retry-After hint the client can show as a countdown. */
class TooManyRequests extends HttpException {
  constructor(message: string, retryAfterSeconds: number) {
    super({ message, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Issues and verifies SMS one-time passcodes.
 * Abuse controls: resend cooldown, per-phone and per-IP hourly limits (Redis),
 * limited attempts per code, single active code per phone, single use.
 * With an OtpVerifier (Twilio Verify) the code is generated, sent and checked by Twilio;
 * every control above still applies to the local challenge row.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(OtpChallenge) private readonly challenges: Repository<OtpChallenge>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: AppConfigService,
    @Optional() @Inject(OTP_VERIFIER) private readonly verifier: OtpVerifier | null = null,
  ) {}

  async issue(phone: string, ip: string | null): Promise<OtpIssued> {
    const cfg = this.config.otp;
    this.assertPhoneAllowed(phone);
    await this.enforceRateLimits(phone, ip);

    // Only the newest code is valid: retire any earlier unused codes.
    await this.challenges.update(
      { phone, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      { expiresAt: new Date() },
    );

    // With Verify, Twilio owns the real code; the local row only tracks expiry/attempts/use,
    // so its hash is of a random value nobody ever receives.
    const code = generateOtpCode();
    const now = Date.now();
    const challenge = await this.challenges.save(
      this.challenges.create({
        phone,
        codeHash: hashOtp(cfg.secret, phone, code),
        expiresAt: new Date(now + cfg.ttlSeconds * 1000),
        requestIp: ip,
      }),
    );

    try {
      if (this.verifier) {
        await this.verifier.start(phone);
      } else {
        await this.sms.send({
          to: phone,
          body: `Your TowNow verification code is ${code}. It expires in ${Math.round(cfg.ttlSeconds / 60)} minutes. Never share this code.`,
        });
      }
    } catch (err) {
      // Don't leave an unusable code behind or block the user from retrying.
      await this.challenges.update(challenge.id, { expiresAt: new Date() });
      await this.redis.del(this.cooldownKey(phone));
      const reason =
        err instanceof SmsDeliveryError ? `${err.provider}: ${err.message}` : String(err);
      this.logger.error(`OTP SMS to ${maskPhone(phone)} failed — ${reason}`);
      throw new ServiceUnavailableException(
        'We could not send the SMS right now. Please try again.',
      );
    }

    return {
      expiresAt: challenge.expiresAt,
      resendAvailableAt: new Date(now + cfg.resendCooldownSeconds * 1000),
    };
  }

  /** Throws on any failure; returns only when the code is correct and now consumed. */
  async verify(phone: string, code: string): Promise<void> {
    const { maxAttempts } = this.config.otp;
    this.assertPhoneAllowed(phone);
    const challenge = await this.challenges.findOne({
      where: { phone, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
    if (!challenge) {
      throw new BadRequestException(
        'This code has expired or was never requested. Request a new code.',
      );
    }
    if (challenge.attempts >= maxAttempts) {
      throw new TooManyRequests('Too many incorrect attempts. Request a new code.', 0);
    }

    if (!(await this.codeIsCorrect(challenge.id, phone, code, challenge.codeHash))) {
      // Atomic increment, so parallel guesses cannot exceed the limit.
      const result = await this.challenges
        .createQueryBuilder()
        .update()
        .set({ attempts: () => 'attempts + 1' })
        .where('id = :id', { id: challenge.id })
        .returning('attempts')
        .execute();
      const attempts = (result.raw as { attempts: number }[])[0]?.attempts ?? maxAttempts;
      const remaining = Math.max(0, maxAttempts - attempts);
      throw new UnauthorizedException(
        remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
          : 'Incorrect code. No attempts left — request a new code.',
      );
    }

    // Conditional update makes the code single-use even under concurrent verifies.
    const result = await this.challenges.update(
      { id: challenge.id, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    if (!result.affected) {
      throw new BadRequestException('This code has already been used. Request a new code.');
    }
  }

  /** Local hash comparison, or Twilio Verify's check when configured. */
  private async codeIsCorrect(
    challengeId: string,
    phone: string,
    code: string,
    codeHash: string,
  ): Promise<boolean> {
    if (!this.verifier) return otpMatches(this.config.otp.secret, phone, code, codeHash);
    let result;
    try {
      result = await this.verifier.check(phone, code);
    } catch (err) {
      const reason =
        err instanceof SmsDeliveryError ? `${err.provider}: ${err.message}` : String(err);
      this.logger.error(`OTP check for ${maskPhone(phone)} failed — ${reason}`);
      throw new ServiceUnavailableException(
        'We could not check the code right now. Please try again.',
      );
    }
    if (result === 'approved') return true;
    if (result === 'incorrect') return false;
    // Twilio no longer has a pending code (expired / used up): retire ours too.
    await this.challenges.update(challengeId, { expiresAt: new Date() });
    if (result === 'too_many_attempts') {
      throw new TooManyRequests('Too many incorrect attempts. Request a new code.', 0);
    }
    throw new BadRequestException(
      'This code has expired or was never requested. Request a new code.',
    );
  }

  /** Only UAE numbers, plus +91 when DEV_ALLOW_INDIA_PHONES is on (development only). */
  private assertPhoneAllowed(phone: string): void {
    if (isUaeMobileE164(phone) || this.config.otp.devAllowIndiaPhones) return;
    throw new BadRequestException('phone must be a valid UAE mobile number, e.g. 050 123 4567');
  }

  private async enforceRateLimits(phone: string, ip: string | null): Promise<void> {
    const cfg = this.config.otp;

    const cooldownLeft = await this.redis.ttl(this.cooldownKey(phone));
    if (cooldownLeft > 0) {
      throw new TooManyRequests(
        `Please wait ${cooldownLeft}s before requesting another code.`,
        cooldownLeft,
      );
    }

    const phoneCount = await this.hit(`otp:phone:${phone}`);
    if (phoneCount > cfg.phoneHourlyLimit) {
      const ttl = await this.redis.ttl(`otp:phone:${phone}`);
      throw new TooManyRequests('Too many codes requested for this number. Try again later.', ttl);
    }
    if (ip) {
      const ipCount = await this.hit(`otp:ip:${ip}`);
      if (ipCount > cfg.ipHourlyLimit) {
        const ttl = await this.redis.ttl(`otp:ip:${ip}`);
        throw new TooManyRequests('Too many codes requested. Try again later.', ttl);
      }
    }

    if (cfg.resendCooldownSeconds > 0) {
      await this.redis.set(this.cooldownKey(phone), '1', 'EX', cfg.resendCooldownSeconds);
    }
  }

  /** Fixed-window counter: first hit starts a one-hour window. */
  private async hit(key: string): Promise<number> {
    const [[, count]] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, HOUR_SECONDS, 'NX')
      .exec()) as [[Error | null, number], [Error | null, number]];
    return count;
  }

  private cooldownKey(phone: string): string {
    return `otp:cooldown:${phone}`;
  }
}
