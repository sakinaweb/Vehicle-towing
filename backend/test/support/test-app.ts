import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { startWorkers } from '../../src/infrastructure/queue/start-workers.js';
import { REDIS_CLIENT } from '../../src/infrastructure/redis/redis.module.js';
import {
  SMS_PROVIDER,
  SmsDeliveryError,
  SmsMessage,
  SmsProvider,
  SmsSendResult,
} from '../../src/infrastructure/sms/sms-provider.js';
import {
  OTP_VERIFIER,
  type OtpVerifier,
} from '../../src/infrastructure/sms/twilio-verify.client.js';

/**
 * Stands in for the SMS gateway at the network edge only: everything else
 * (OTP storage, hashing, rate limits, tokens) runs for real.
 */
export class CapturingSmsProvider implements SmsProvider {
  readonly name = 'capture';
  readonly sent: SmsMessage[] = [];
  failNext = false;

  send(message: SmsMessage): Promise<SmsSendResult> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new SmsDeliveryError('Simulated gateway outage', this.name));
    }
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `cap-${this.sent.length}` });
  }

  /** The code from the latest SMS to this number, read the way a user would. */
  lastCode(phone: string): string {
    const msg = [...this.sent].reverse().find((m) => m.to === phone);
    const code = msg?.body.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`No OTP SMS sent to ${phone}`);
    return code;
  }
}

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  sms: CapturingSmsProvider;
  ds: DataSource;
  redis: Redis;
  close: () => Promise<void>;
}

export async function createTestApp(
  extra: {
    controllers?: (new (...args: never[]) => unknown)[];
    /** Stand-in for Twilio Verify (codes issued and checked externally). */
    otpVerifier?: OtpVerifier;
  } = {},
): Promise<TestApp> {
  const sms = new CapturingSmsProvider();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
  })
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .overrideProvider(OTP_VERIFIER)
    .useValue(extra.otpVerifier ?? null)
    .compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.listen(0);
  startWorkers(app);
  const redis = app.get<Redis>(REDIS_CLIENT);
  await redis.flushdb(); // DB 1 is reserved for tests (see vitest.config.e2e.ts)

  return {
    app,
    baseUrl: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
    sms,
    ds: app.get<DataSource>(getDataSourceToken()),
    redis,
    close: () => app.close(),
  };
}

const TEST_RUN_STARTED_AT = new Date();
let counter = 0;
/** A fresh, valid UAE mobile number per call (E.164), unique per test run. */
export function uniquePhone(): string {
  counter += 1;
  const tail =
    (Date.now() % 1e5).toString().padStart(5, '0') + (counter % 100).toString().padStart(2, '0');
  return `+97158${tail}`;
}

/** Removes everything a test created for these phone numbers (FK-safe order). */
export async function deleteUsersByPhone(ds: DataSource, phones: string[]): Promise<void> {
  if (phones.length === 0) return;
  await ds.transaction(async (em) => {
    // e2e shares the dev database: never delete an account that existed before this test run,
    // even if a generated number happens to match it.
    const users: { id: string }[] = await em.query(
      'SELECT id FROM users WHERE phone = ANY($1) AND created_at >= $2',
      [phones, TEST_RUN_STARTED_AT],
    );
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await em.query(
        `DELETE FROM audit_logs WHERE actor_user_id = ANY($1) OR entity_id = ANY($1)
            OR entity_id IN (SELECT id FROM drivers WHERE user_id = ANY($1))
            OR entity_id IN (SELECT b.id FROM bookings b JOIN customers c ON c.id = b.customer_id
                              WHERE c.user_id = ANY($1))`,
        [ids],
      );
      // Payment records reference bookings with RESTRICT, so they go before the bookings.
      for (const table of ['disputes', 'invoices', 'driver_ledger_entries', 'payments']) {
        await em.query(
          `DELETE FROM ${table} WHERE booking_id IN (SELECT b.id FROM bookings b JOIN customers c ON c.id = b.customer_id
              WHERE c.user_id = ANY($1))`,
          [ids],
        );
      }
      // SOS alerts and chat messages reference their author with RESTRICT.
      await em.query('DELETE FROM sos_alerts WHERE raised_by_id = ANY($1)', [ids]);
      await em.query('DELETE FROM chat_messages WHERE sender_id = ANY($1)', [ids]);
      // Bookings reference customers/vehicles with RESTRICT, so they go first (history cascades).
      await em.query(
        'DELETE FROM bookings WHERE customer_id IN (SELECT id FROM customers WHERE user_id = ANY($1))',
        [ids],
      );
      // Settlements have no booking.
      await em.query(
        'DELETE FROM driver_ledger_entries WHERE driver_id IN (SELECT id FROM drivers WHERE user_id = ANY($1))',
        [ids],
      );
      await em.query('DELETE FROM drivers WHERE user_id = ANY($1)', [ids]); // cascades tow trucks
      await em.query('DELETE FROM customers WHERE user_id = ANY($1)', [ids]);
      await em.query('DELETE FROM users WHERE id = ANY($1)', [ids]); // cascades sessions
    }
    await em.query('DELETE FROM otp_challenges WHERE phone = ANY($1)', [phones]);
  });
}

/** Signs a fresh phone number in through the real OTP flow; remembers it for clean-up. */
export async function signInAs(
  t: TestApp,
  role: 'customer' | 'driver' | 'admin',
  phones: string[],
): Promise<{ token: string; phone: string; userId: string }> {
  const phone = uniquePhone();
  phones.push(phone);
  // Admins are provisioned (npm run admin:create), never created by signing in.
  if (role === 'admin') {
    await t.ds.query("INSERT INTO users (phone, role, status) VALUES ($1, 'admin', 'active')", [
      phone,
    ]);
  }
  const { default: request } = await import('supertest');
  await request(t.baseUrl).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
  const res = await request(t.baseUrl)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: t.sms.lastCode(phone), role })
    .expect(200);
  return {
    token: `Bearer ${res.body.accessToken as string}`,
    phone,
    userId: res.body.user.id as string,
  };
}
