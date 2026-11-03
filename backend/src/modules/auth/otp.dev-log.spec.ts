import { ConflictException, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserRole, UserStatus } from '../../common/enums.js';
import { normalizeUaeMobile } from '../../common/phone.js';
import type { AppConfigService } from '../../config/app-config.service.js';
import { LogSmsProvider } from '../../infrastructure/sms/log-sms.provider.js';
import { SmsDeliveryError } from '../../infrastructure/sms/sms-provider.js';
import { AuthService } from './auth.service.js';
import { RequestOtpDto, VerifyOtpDto } from './dto.js';
import { OtpService } from './otp.service.js';

/**
 * Local testing without a UAE SIM: SMS_PROVIDER=log (development only) writes the
 * random code to the API terminal. Any well-formed UAE test number works; the code
 * must still be entered. In-memory doubles stand in for Postgres and Redis.
 */

interface Row {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  externalCheck?: boolean;
}

function fakeChallenges() {
  const rows: Row[] = [];
  const live = (r: Row) => !r.consumedAt && r.expiresAt > new Date();
  return {
    rows,
    create: (r: Partial<Row>) => ({ ...r }),
    save: (r: Row) => {
      const row = { ...r, id: `c${rows.length + 1}`, consumedAt: null, attempts: 0 };
      rows.push(row);
      return Promise.resolve(row);
    },
    findOne: ({ where }: { where: { phone: string } }) =>
      Promise.resolve(rows.filter((r) => r.phone === where.phone && live(r)).at(-1) ?? null),
    update: (criteria: string | { id?: string; phone?: string }, patch: Partial<Row>) => {
      const hit = rows.filter((r) =>
        typeof criteria === 'string'
          ? r.id === criteria
          : criteria.id
            ? r.id === criteria.id && !r.consumedAt
            : r.phone === criteria.phone && live(r),
      );
      hit.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ affected: hit.length });
    },
    createQueryBuilder: () => {
      let id = '';
      const qb = {
        update: () => qb,
        set: () => qb,
        where: (_: string, p: { id: string }) => ((id = p.id), qb),
        returning: () => qb,
        execute: () => {
          const row = rows.find((r) => r.id === id)!;
          row.attempts++;
          return Promise.resolve({ raw: [{ attempts: row.attempts }] });
        },
      };
      return qb;
    },
  };
}

function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    ttl: () => Promise.resolve(-2),
    set: () => Promise.resolve('OK'),
    del: () => Promise.resolve(1),
    multi: () => ({
      incr: (k: string) => ({
        expire: () => ({
          exec: () => {
            counts.set(k, (counts.get(k) ?? 0) + 1);
            return Promise.resolve([
              [null, counts.get(k)],
              [null, 1],
            ]);
          },
        }),
      }),
    }),
  };
}

const config = {
  otp: {
    secret: 'x'.repeat(48),
    ttlSeconds: 300,
    maxAttempts: 5,
    resendCooldownSeconds: 30,
    phoneHourlyLimit: 5,
    ipHourlyLimit: 30,
    countries: ['AE'],
  },
} as unknown as AppConfigService;

function setup(cfg: AppConfigService = config) {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const challenges = fakeChallenges();
  const otp = new OtpService(
    challenges as never,
    fakeRedis() as never,
    new LogSmsProvider(),
    cfg,
    null,
  );
  const loggedCode = () => {
    const line = String(warn.mock.calls.at(-1)?.[0] ?? '');
    return { line, code: /code is (\d{6})/.exec(line)?.[1] };
  };
  return { otp, challenges, loggedCode };
}

afterEach(() => vi.restoreAllMocks());

describe('development OTP via SMS_PROVIDER=log', () => {
  const testPhone = normalizeUaeMobile('58 777 0101')!; // made-up UAE-format test number

  it('logs a random code (masked number) and never returns it from the API layer', async () => {
    const { otp, challenges, loggedCode } = setup();
    const issued = await otp.issue(testPhone, '127.0.0.1');

    const { line, code } = loggedCode();
    expect(line).toContain('[DEV ONLY]');
    expect(line).toContain('+97158*****01');
    expect(line).not.toContain(testPhone);
    expect(code).toMatch(/^\d{6}$/);
    expect(Object.keys(issued).sort()).toEqual(['expiresAt', 'resendAvailableAt']);
    expect(JSON.stringify(issued)).not.toContain(code!);
    expect(challenges.rows[0].codeHash).not.toContain(code!); // only a keyed hash is stored
  });

  it('still requires the logged code: wrong codes fail, the right one works once', async () => {
    const { otp, loggedCode } = setup();
    await otp.issue(testPhone, null);
    const { code } = loggedCode();
    const wrong = code === '000000' ? '111111' : '000000';

    await expect(otp.verify(testPhone, wrong)).rejects.toThrow('Incorrect code. 4 attempts left.');
    await expect(otp.verify(testPhone, code!)).resolves.toBeUndefined();
    await expect(otp.verify(testPhone, code!)).rejects.toThrow(/expired or was never requested/);
  });

  it('issues a different code each time (no fixed test OTP)', async () => {
    const { otp, loggedCode } = setup();
    const codes = new Set<string>();
    for (const n of ['58 777 0101', '58 777 0102', '58 777 0103', '58 777 0104']) {
      await otp.issue(normalizeUaeMobile(n)!, null);
      codes.add(loggedCode().code!);
    }
    expect(codes.size).toBeGreaterThan(1);
  });

  it('a code only works for the number it was sent to', async () => {
    const { otp, loggedCode } = setup();
    await otp.issue(testPhone, null);
    const other = normalizeUaeMobile('58 777 0199')!;
    await expect(otp.verify(other, loggedCode().code!)).rejects.toThrow(/never requested/);
  });
});

describe('development Indian (+91) numbers via DEV_ALLOW_INDIA_PHONES', () => {
  const india = '+919876543210'; // made-up test number
  const withIndia = {
    otp: { ...config.otp, devAllowIndiaPhones: true },
  } as unknown as AppConfigService;

  it('sign-in DTOs accept +91 and +971 formats and normalise them to E.164', () => {
    for (const [input, e164] of [
      ['+91 98765 43210', india],
      ['0091-98765-43210', india],
      ['+971 50 123 4567', '+971501234567'],
      ['050 123 4567', '+971501234567'],
    ]) {
      const dto = plainToInstance(VerifyOtpDto, { phone: input, code: '123456', role: 'driver' });
      expect(validateSync(dto)).toEqual([]);
      expect(dto.phone).toBe(e164);
    }
    for (const bad of ['98765 43210', '+91 58765 43210', '+44 7700 900123', '+91 98765 4321']) {
      expect(validateSync(plainToInstance(RequestOtpDto, { phone: bad }))).not.toEqual([]);
    }
  });

  it('refuses +91 when the flag is off (the default, and always in production)', async () => {
    const { otp, challenges } = setup();
    await expect(otp.issue(india, null)).rejects.toThrow(/valid UAE mobile number/);
    await expect(otp.verify(india, '123456')).rejects.toThrow(/valid UAE mobile number/);
    expect(challenges.rows).toHaveLength(0);
  });

  it('with the flag on, +91 still needs the logged code: wrong fails, right works once', async () => {
    const { otp, loggedCode } = setup(withIndia);
    await otp.issue(india, null);
    const { line, code } = loggedCode();
    expect(line).toContain('+91987*****10');
    expect(line).not.toContain(india);
    const wrong = code === '000000' ? '111111' : '000000';

    await expect(otp.verify(india, wrong)).rejects.toThrow('Incorrect code. 4 attempts left.');
    await expect(otp.verify(india, code!)).resolves.toBeUndefined();
    await expect(otp.verify(india, code!)).rejects.toThrow(/expired or was never requested/);
  });

  it('UAE numbers work the same with the flag on', async () => {
    const { otp, loggedCode } = setup(withIndia);
    await otp.issue('+971501234567', null);
    await expect(otp.verify('+971501234567', loggedCode().code!)).resolves.toBeUndefined();
  });

  it('a +91 customer cannot sign in to the driver app, and no account is created', async () => {
    const customer = { id: 'u1', phone: india, role: UserRole.Customer, status: UserStatus.Active };
    const insert = vi.fn();
    const em = {
      createQueryBuilder: () => {
        const qb = {
          insert: () => qb,
          into: () => qb,
          values: (v: unknown) => (insert(v), qb),
          orIgnore: () => qb,
          returning: () => qb,
          execute: () => Promise.resolve({ raw: [] }), // phone already taken: nothing inserted
        };
        return qb;
      },
      findOneBy: () => Promise.resolve(customer),
      update: vi.fn(),
    };
    const otp = { verify: vi.fn().mockResolvedValue(undefined) };
    const tokens = { startSession: vi.fn() };
    const auth = new AuthService(
      otp as never,
      tokens as never,
      { record: vi.fn() } as never,
      {
        transaction: (fn: (m: typeof em) => unknown) => fn(em),
      } as never,
    );

    const signIn = auth.signInWithOtp(india, '123456', UserRole.Driver, {
      ip: null,
      userAgent: null,
    });
    await expect(signIn).rejects.toThrow(ConflictException);
    await expect(signIn).rejects.toThrow('This number is registered as a customer account');
    expect(otp.verify).toHaveBeenCalledWith(india, '123456'); // code checked first
    expect(em.update).not.toHaveBeenCalled();
    expect(tokens.startSession).not.toHaveBeenCalled();
  });
});

describe('OTP_COUNTRIES', () => {
  it('signs in +91 when IN is listed, without the dev flag', async () => {
    const withIn = {
      otp: { ...config.otp, countries: ['AE', 'IN'] },
    } as unknown as AppConfigService;
    const { otp, loggedCode } = setup(withIn);
    await otp.issue('+919876543210', null);
    await expect(otp.verify('+919876543210', loggedCode().code!)).resolves.toBeUndefined();
  });

  it('refuses UAE numbers when AE is not listed', async () => {
    const onlyIn = { otp: { ...config.otp, countries: ['IN'] } } as unknown as AppConfigService;
    const { otp } = setup(onlyIn);
    await expect(otp.issue('+971501234567', null)).rejects.toThrow(/valid UAE mobile/);
  });
});

describe('Twilio Verify with a backup SMS provider', () => {
  const phone = '+971501234567';

  function withVerify(startFails: boolean) {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const backup = {
      name: 'infobip',
      send: vi.fn().mockResolvedValue({ providerMessageId: 'b1' }),
    };
    const verifier = {
      name: 'twilio_verify',
      start: startFails
        ? vi.fn().mockRejectedValue(new SmsDeliveryError('Verify down', 'twilio_verify', 60200))
        : vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue('approved'),
    };
    const challenges = fakeChallenges();
    const otp = new OtpService(challenges as never, fakeRedis() as never, backup, config, verifier);
    const sentCode = () =>
      /code is (\d{6})/.exec(String(backup.send.mock.calls.at(-1)?.[0]?.body))?.[1];
    return { otp, backup, verifier, challenges, sentCode, warn };
  }

  it('Verify works: no backup SMS, Twilio checks the code', async () => {
    const { otp, backup, verifier, challenges } = withVerify(false);
    await otp.issue(phone, null);
    expect(backup.send).not.toHaveBeenCalled();
    expect(challenges.rows[0].externalCheck).toBe(true);
    await expect(otp.verify(phone, '123456')).resolves.toBeUndefined();
    expect(verifier.check).toHaveBeenCalledWith(phone, '123456');
  });

  it('Verify fails: the backup delivers the one local code, checked locally, never by Twilio', async () => {
    const { otp, backup, verifier, challenges, sentCode, warn } = withVerify(true);
    await otp.issue(phone, null);
    expect(backup.send).toHaveBeenCalledOnce();
    expect(challenges.rows[0].externalCheck).toBe(false);
    const code = sentCode()!;
    expect(code).toMatch(/^\d{6}$/);
    expect(String(warn.mock.calls.at(-1)?.[0])).not.toContain(code); // OTP never logged

    const wrong = code === '000000' ? '111111' : '000000';
    await expect(otp.verify(phone, wrong)).rejects.toThrow('Incorrect code. 4 attempts left.');
    await expect(otp.verify(phone, code)).resolves.toBeUndefined();
    expect(verifier.check).not.toHaveBeenCalled();
  });

  it('Verify and backup both fail: 503, and the code row is retired', async () => {
    const { otp, backup, challenges } = withVerify(true);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    backup.send.mockRejectedValue(new SmsDeliveryError('no route', 'infobip'));
    await expect(otp.issue(phone, null)).rejects.toThrow(/could not send the SMS/);
    expect(challenges.rows[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('demo login (DEMO_LOGIN_PHONES + DEMO_LOGIN_CODE)', () => {
  const demoCode = '482917'; // test value only
  const demoPhone = '+971589990411';
  const other = '+971589990499';
  const withDemo = {
    otp: { ...config.otp, demoPhones: [demoPhone], demoCode },
  } as unknown as AppConfigService;

  it('a listed number gets the demo code (no SMS); it still works only once', async () => {
    const { otp, challenges } = setup(withDemo);
    const warn = vi.spyOn(Logger.prototype, 'warn');
    await otp.issue(demoPhone, null);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('[DEV ONLY]'))).toBe(false); // nothing "sent"
    expect(lines.some((l) => l.includes(demoCode))).toBe(false); // code never logged
    expect(challenges.rows[0].codeHash).not.toContain(demoCode); // still only a hash

    await expect(otp.verify(demoPhone, '000000')).rejects.toThrow(
      'Incorrect code. 4 attempts left.',
    );
    await expect(otp.verify(demoPhone, demoCode)).resolves.toBeUndefined();
    await expect(otp.verify(demoPhone, demoCode)).rejects.toThrow(/expired or was never requested/);
  });

  it('every other number keeps the normal SMS flow, and the demo code does not work for it', async () => {
    const { otp, loggedCode } = setup(withDemo);
    await otp.issue(other, null);
    const { line, code } = loggedCode();
    expect(line).toContain('[DEV ONLY]'); // a real (random) code went to the SMS provider
    expect(otp.isDemoPhone(other)).toBe(false);
    if (code !== demoCode) {
      await expect(otp.verify(other, demoCode)).rejects.toThrow(/Incorrect code/);
    }
    await expect(otp.verify(other, code!)).resolves.toBeUndefined();
  });

  it('is off without a code, even if numbers are listed', () => {
    const noCode = {
      otp: { ...config.otp, demoPhones: [demoPhone] },
    } as unknown as AppConfigService;
    expect(setup(noCode).otp.isDemoPhone(demoPhone)).toBe(false);
    expect(setup().otp.isDemoPhone(demoPhone)).toBe(false); // default config
  });
});
