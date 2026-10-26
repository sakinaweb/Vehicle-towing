import request from 'supertest';
import type {
  OtpCheckResult,
  OtpVerifier,
} from '../src/infrastructure/sms/twilio-verify.client.js';
import {
  createTestApp,
  deleteUsersByPhone,
  uniquePhone,
  type TestApp,
} from './support/test-app.js';

/**
 * Sign-in with Twilio Verify issuing and checking codes (SMS_PROVIDER=twilio_verify),
 * using an in-memory stand-in for Twilio — no real SMS, no charges. The app's own
 * controls (cooldown, attempt limit, single use) must still apply.
 */
class FakeVerify implements OtpVerifier {
  readonly name = 'fake_verify';
  readonly started: string[] = [];
  private readonly codes = new Map<string, string>();
  checks = 0;

  start(phone: string): Promise<void> {
    this.started.push(phone);
    this.codes.set(phone, String(100000 + this.started.length)); // the "SMS" Twilio would send
    return Promise.resolve();
  }

  check(phone: string, code: string): Promise<OtpCheckResult> {
    this.checks += 1;
    const expected = this.codes.get(phone);
    if (!expected) return Promise.resolve('expired');
    if (expected !== code) return Promise.resolve('incorrect');
    this.codes.delete(phone); // Twilio deletes an approved verification
    return Promise.resolve('approved');
  }

  codeFor(phone: string): string {
    return this.codes.get(phone)!;
  }
}

describe('OTP sign-in via Twilio Verify (e2e, fake Verify)', () => {
  const verify = new FakeVerify();
  let t: TestApp;
  const phones: string[] = [];
  const api = () => request(t.baseUrl);

  beforeAll(async () => {
    t = await createTestApp({ otpVerifier: verify });
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
  });

  it('lets Verify send and check the code; our own SMS is never sent', async () => {
    const phone = uniquePhone();
    phones.push(phone);
    await api().post('/api/v1/auth/otp/request').send({ phone }).expect(202);
    expect(verify.started).toContain(phone);
    expect(t.sms.sent.find((m) => m.to === phone)).toBeUndefined();

    const wrong = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: '000000', role: 'customer' })
      .expect(401);
    expect(wrong.body.message).toMatch(/Incorrect code\. 4 attempts left/);

    const ok = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: verify.codeFor(phone), role: 'customer' })
      .expect(200);
    expect(ok.body.user.phone).toBe(phone);
    expect(ok.body.accessToken).toEqual(expect.any(String));

    // Single use: the same code can't sign in twice.
    await api()
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: '100001', role: 'customer' })
      .expect(400);
  });

  it('still enforces the resend cooldown and the local attempt limit', async () => {
    const phone = uniquePhone();
    phones.push(phone);
    await api().post('/api/v1/auth/otp/request').send({ phone }).expect(202);
    await api().post('/api/v1/auth/otp/request').send({ phone }).expect(429);
    expect(verify.started.filter((p) => p === phone)).toHaveLength(1); // no second Twilio send

    const before = verify.checks;
    for (let i = 0; i < 5; i++) {
      await api()
        .post('/api/v1/auth/otp/verify')
        .send({ phone, code: '999999', role: 'customer' })
        .expect(401);
    }
    // Limit reached locally: Twilio isn't even asked again.
    await api()
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: verify.codeFor(phone), role: 'customer' })
      .expect(429);
    expect(verify.checks - before).toBe(5);
  });
});
