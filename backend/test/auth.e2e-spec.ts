import request from 'supertest';
import { createTestApp, deleteUsersByPhone, TestApp, uniquePhone } from './support/test-app.js';

const OTP = '/api/v1/auth/otp';

/** Asserts the status of an already-awaited response, showing the body on failure. */
const expectStatus = (status: number) => (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};

/** Extracts "name=value" and attributes of a Set-Cookie header. */
function findCookie(res: request.Response, name: string) {
  const raw = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith(`${name}=`));
  if (!raw) return undefined;
  const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
  return { pair, value: pair.slice(name.length + 1), attrs: attrs.map((a) => a.toLowerCase()) };
}

describe('Auth (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  const newPhone = () => {
    const p = uniquePhone();
    phones.push(p);
    return p;
  };

  /** Full OTP sign-in; returns the HTTP response of /verify. */
  async function signIn(
    phone: string,
    role: 'customer' | 'driver' = 'customer',
    headers: Record<string, string> = {},
  ) {
    await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(202);
    return request(t.baseUrl)
      .post(`${OTP}/verify`)
      .set(headers)
      .send({ phone, code: t.sms.lastCode(phone), role });
  }

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
  });

  describe('OTP request', () => {
    it('rejects numbers that are not UAE mobiles', async () => {
      for (const phone of ['+447700900123', '04 123 4567', '51 123 4567', 'hello']) {
        const res = await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(400);
        expect(res.body.message).toContain(
          'phone must be a valid UAE mobile number, e.g. 050 123 4567',
        );
      }
    });

    it('accepts local formats, sends a 6-digit SMS and stores only a hash', async () => {
      const phone = newPhone();
      const local = `0${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`; // 058 xxx xxxx
      const res = await request(t.baseUrl)
        .post(`${OTP}/request`)
        .send({ phone: local })
        .expect(202);

      expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
      expect(Date.parse(res.body.resendAvailableAt)).toBeGreaterThan(Date.now());
      const code = t.sms.lastCode(phone); // SMS went to the normalised E.164 number
      expect(code).toMatch(/^\d{6}$/);

      const [row]: { code_hash: string }[] = await t.ds.query(
        'SELECT code_hash FROM otp_challenges WHERE phone = $1 ORDER BY created_at DESC LIMIT 1',
        [phone],
      );
      expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.code_hash).not.toContain(code);
    });

    it('enforces the resend cooldown with a retry hint', async () => {
      const phone = newPhone();
      await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(202);
      const res = await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(429);
      expect(res.body.message).toMatch(/Please wait \d+s/);
      expect(res.body.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('caps codes per number per hour', async () => {
      const phone = newPhone();
      for (let i = 0; i < 5; i++) {
        await t.redis.del(`otp:cooldown:${phone}`); // skip the cooldown, keep the hourly counter
        await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(202);
      }
      await t.redis.del(`otp:cooldown:${phone}`);
      const res = await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(429);
      expect(res.body.message).toBe('Too many codes requested for this number. Try again later.');
    });

    it('returns 503 and lets the user retry immediately when the SMS gateway fails', async () => {
      const phone = newPhone();
      t.sms.failNext = true;
      await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(503);
      await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(202); // no cooldown
    });
  });

  describe('OTP verify', () => {
    it('signs up a new customer, sets an HttpOnly refresh cookie and creates the profile', async () => {
      const phone = newPhone();
      const res = await signIn(phone).then(expectStatus(200));

      expect(res.body.isNewUser).toBe(true);
      expect(res.body.user).toMatchObject({ phone, role: 'customer', fullName: null });
      expect(res.body.accessToken.split('.')).toHaveLength(3);
      expect(res.body.refreshToken).toBeUndefined(); // web clients never see it

      const cookie = findCookie(res, 'townow_rt_customer');
      expect(cookie).toBeDefined();
      expect(cookie!.attrs).toEqual(
        expect.arrayContaining(['httponly', 'samesite=strict', 'path=/api/v1/auth']),
      );

      const [profile]: unknown[] = await t.ds.query(
        'SELECT c.id FROM customers c JOIN users u ON u.id = c.user_id WHERE u.phone = $1',
        [phone],
      );
      expect(profile).toBeDefined();
    });

    it('recognises a returning user', async () => {
      const phone = newPhone();
      await signIn(phone).then(expectStatus(200));
      await t.redis.del(`otp:cooldown:${phone}`);
      const again = await signIn(phone).then(expectStatus(200));
      expect(again.body.isNewUser).toBe(false);
    });

    it('counts down wrong attempts, then locks the code', async () => {
      const phone = newPhone();
      await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(202);
      const right = t.sms.lastCode(phone);
      const wrong = right === '000000' ? '111111' : '000000';

      const first = await request(t.baseUrl)
        .post(`${OTP}/verify`)
        .send({ phone, code: wrong, role: 'customer' })
        .expect(401);
      expect(first.body.message).toBe('Incorrect code. 4 attempts left.');
      for (let i = 0; i < 4; i++) {
        await request(t.baseUrl)
          .post(`${OTP}/verify`)
          .send({ phone, code: wrong, role: 'customer' })
          .expect(401);
      }
      // Even the right code is refused once the attempts are used up.
      const locked = await request(t.baseUrl)
        .post(`${OTP}/verify`)
        .send({ phone, code: right, role: 'customer' })
        .expect(429);
      expect(locked.body.message).toBe('Too many incorrect attempts. Request a new code.');
    });

    it('makes codes single-use and invalidates older codes', async () => {
      const phone = newPhone();
      await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(202);
      const oldCode = t.sms.lastCode(phone);
      await t.redis.del(`otp:cooldown:${phone}`);
      await request(t.baseUrl).post(`${OTP}/request`).send({ phone }).expect(202);
      const newCode = t.sms.lastCode(phone);

      if (oldCode !== newCode) {
        await request(t.baseUrl)
          .post(`${OTP}/verify`)
          .send({ phone, code: oldCode, role: 'customer' })
          .expect(401);
      }
      await request(t.baseUrl)
        .post(`${OTP}/verify`)
        .send({ phone, code: newCode, role: 'customer' })
        .expect(200);
      await request(t.baseUrl)
        .post(`${OTP}/verify`)
        .send({ phone, code: newCode, role: 'customer' })
        .expect(400);
    });

    it('refuses to sign a customer number into the driver app', async () => {
      const phone = newPhone();
      await signIn(phone, 'customer').then(expectStatus(200));
      await t.redis.del(`otp:cooldown:${phone}`);
      const res = await signIn(phone, 'driver').then(expectStatus(409));
      expect(res.body.message).toBe(
        'This number is registered as a customer account — sign in from the TowNow app.',
      );
    });

    it('validates the payload', async () => {
      const res = await request(t.baseUrl)
        .post(`${OTP}/verify`)
        .send({ phone: newPhone(), code: '12ab', role: 'staff' })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'code must be the 6-digit code from the SMS',
          expect.stringMatching(/^role must be one of/),
        ]),
      );
    });

    it('writes an audit record for sign-up', async () => {
      const phone = newPhone();
      const { body } = await signIn(phone).then(expectStatus(200));
      const rows: { action: string }[] = await t.ds.query(
        'SELECT action FROM audit_logs WHERE entity_id = $1',
        [body.user.id],
      );
      expect(rows.map((r) => r.action)).toContain('auth.signed_up');
    });
  });

  describe('tokens and sessions', () => {
    it('protects routes by default', async () => {
      await request(t.baseUrl).post('/api/v1/auth/logout').expect(401);
      await request(t.baseUrl)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('rotates the refresh cookie and detects reuse of an old one', async () => {
      const phone = newPhone();
      const login = await signIn(phone).then(expectStatus(200));
      const first = findCookie(login, 'townow_rt_customer')!;

      const refreshed = await request(t.baseUrl)
        .post('/api/v1/auth/refresh')
        .set('Cookie', first.pair)
        .send({ role: 'customer' })
        .expect(200);
      const second = findCookie(refreshed, 'townow_rt_customer')!;
      expect(second.value).not.toBe(first.value);
      expect(refreshed.body.accessToken).toBeTruthy();

      // Replaying the old cookie = token theft: the whole session is revoked…
      await request(t.baseUrl)
        .post('/api/v1/auth/refresh')
        .set('Cookie', first.pair)
        .send({ role: 'customer' })
        .expect(401);
      // …so even the legitimate newest token stops working.
      await request(t.baseUrl)
        .post('/api/v1/auth/refresh')
        .set('Cookie', second.pair)
        .send({ role: 'customer' })
        .expect(401);

      const [{ count }]: { count: string }[] = await t.ds.query(
        "SELECT count(*) FROM audit_logs WHERE action = 'auth.refresh_token_reuse' AND actor_user_id = $1",
        [login.body.user.id],
      );
      expect(Number(count)).toBe(1);
    });

    it('gives mobile clients the refresh token in the body (no cookie)', async () => {
      const phone = newPhone();
      const login = await signIn(phone, 'customer', { 'X-Client-Type': 'mobile' }).then(
        expectStatus(200),
      );
      expect(login.body.refreshToken).toMatch(/^[0-9a-f-]{36}\.[\w-]{43}$/);
      expect(findCookie(login, 'townow_rt_customer')).toBeUndefined();

      const refreshed = await request(t.baseUrl)
        .post('/api/v1/auth/refresh')
        .set('X-Client-Type', 'mobile')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);
      expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken);
    });

    it('rejects garbage refresh tokens', async () => {
      await request(t.baseUrl)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'nope' })
        .expect(401);
      await request(t.baseUrl).post('/api/v1/auth/refresh').send({}).expect(401);
    });

    it('logout revokes the session immediately, including the live access token', async () => {
      const phone = newPhone();
      const login = await signIn(phone).then(expectStatus(200));
      const bearer = `Bearer ${login.body.accessToken}`;
      const cookie = findCookie(login, 'townow_rt_customer')!;

      const out = await request(t.baseUrl)
        .post('/api/v1/auth/logout')
        .set('Authorization', bearer)
        .expect(204);
      expect(findCookie(out, 'townow_rt_customer')?.value).toBe(''); // cookie cleared

      await request(t.baseUrl).post('/api/v1/auth/logout').set('Authorization', bearer).expect(401);
      await request(t.baseUrl)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie.pair)
        .send({ role: 'customer' })
        .expect(401);
    });

    it('logout-all ends every session of the user', async () => {
      const phone = newPhone();
      const a = await signIn(phone, 'customer', { 'X-Client-Type': 'mobile' }).then(
        expectStatus(200),
      );
      await t.redis.del(`otp:cooldown:${phone}`);
      const b = await signIn(phone, 'customer', { 'X-Client-Type': 'mobile' }).then(
        expectStatus(200),
      );

      const res = await request(t.baseUrl)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${b.body.accessToken}`)
        .expect(200);
      expect(res.body.sessionsEnded).toBe(2);

      for (const s of [a, b]) {
        await request(t.baseUrl)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: s.body.refreshToken })
          .expect(401);
      }
    });
  });
});
