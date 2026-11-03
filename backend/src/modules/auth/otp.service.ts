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
import { maskPhone, mobileCountry } from '../../common/phone.js';
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
    /** Null only with Twilio Verify and no backup provider. */
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider | null,
    private readonly config: AppConfigService,
    @Optional() @Inject(OTP_VERIFIER) private readonly verifier: OtpVerifier | null = null,
  ) {}

  onModuleInit(): void {
    const { demoPhones = [], demoCode } = this.config.otp;
    if (demoCode && demoPhones.length) {
      this.logger.warn(
        `DEMO LOGIN ENABLED for ${demoPhones.length} number(s): ${demoPhones.map(maskPhone).join(', ')} — not for production`,
      );
    }
  }

  /** Demo login: only these exact numbers (DEMO_LOGIN_PHONES, refused in production). */
  isDemoPhone(phone: string): boolean {
    const { demoPhones = [], demoCode } = this.config.otp;
    return !!demoCode && demoPhones.includes(phone);
  }

  async issue(phone: string, ip: string | null): Promise<OtpIssued> {
    const cfg = this.config.otp;
    this.assertPhoneAllowed(phone);
    await this.enforceRateLimits(phone, ip);

    // Only the newest code is valid: retire any earlier unused codes.
    await this.challenges.update(
      { phone, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      { expiresAt: new Date() },
    );

    // With Verify, Twilio owns the real code and the local row only tracks expiry/attempts/use;
    // its hash is of a random value nobody receives — unless Verify fails and the backup SMS
    // delivers exactly that value. Either way the user holds one valid code.
    // Demo numbers get the configured demo code instead of an SMS; the challenge row is the same,
    // so expiry, attempt limit, single use and rate limits apply exactly as for everyone else.
    const demo = this.isDemoPhone(phone);
    const code = demo ? cfg.demoCode! : generateOtpCode();
    const now = Date.now();
    const challenge = await this.challenges.save(
      this.challenges.create({
        phone,
        codeHash: hashOtp(cfg.secret, phone, code),
        expiresAt: new Date(now + cfg.ttlSeconds * 1000),
        externalCheck: !!this.verifier && !demo,
        requestIp: ip,
      }),
    );
    const issued = {
      expiresAt: challenge.expiresAt,
      resendAvailableAt: new Date(now + cfg.resendCooldownSeconds * 1000),
    };
    if (demo) {
      this.logger.warn(`DEMO login code issued to ${maskPhone(phone)} (no SMS sent)`);
      return issued;
    }

    try {
      if (this.verifier) {
        try {
          await this.verifier.start(phone);
        } catch (err) {
          if (!this.sms) throw err;
          const code = err instanceof SmsDeliveryError ? (err.providerCode ?? 'n/a') : 'n/a';
          this.logger.warn(
            `${this.verifier.name} failed for ${maskPhone(phone)} (code=${code}) — using backup ${this.sms.name}`,
          );
          await this.challenges.update(challenge.id, { externalCheck: false });
          challenge.externalCheck = false;
        }
      }
      if (!challenge.externalCheck) {
        await this.sms!.send({
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

    return issued;
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

    if (!(await this.codeIsCorrect(challenge, phone, code))) {
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

  /** Twilio Verify's check when Verify sent this code, otherwise our own hash comparison. */
  private async codeIsCorrect(
    challenge: OtpChallenge,
    phone: string,
    code: string,
  ): Promise<boolean> {
    const challengeId = challenge.id;
    if (!this.verifier || !challenge.externalCheck) {
      return otpMatches(this.config.otp.secret, phone, code, challenge.codeHash);
    }
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

  /** Mobiles of the OTP_COUNTRIES, plus +91 when DEV_ALLOW_INDIA_PHONES is on (development only). */
  private assertPhoneAllowed(phone: string): void {
    const { countries, devAllowIndiaPhones } = this.config.otp;
    const country = mobileCountry(phone);
    if (country && (countries.includes(country) || (devAllowIndiaPhones && country === 'IN'))) {
      return;
    }
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
