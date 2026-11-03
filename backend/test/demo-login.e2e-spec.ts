// Must stay the first import: demo login is switched on before the app module loads.
import { DEMO } from './support/demo-env.js';
import request from 'supertest';
import { createTestApp, deleteUsersByPhone, TestApp, uniquePhone } from './support/test-app.js';

/**
 * Demo login: listed numbers sign in with DEMO_LOGIN_CODE (no SMS); everyone else keeps the
 * normal OTP flow. Real API, PostgreSQL and Redis; the SMS gateway is captured at the edge.
 */
const OTP = '/api/v1/auth/otp';
const DEMO_CODE = DEMO.code; // test-only value; the real one lives only in backend/.env

describe('Demo login (e2e)', () => {
  let t: TestApp;
  const demoCustomer = DEMO.customer;
  const demoDriver = DEMO.driver;
  const normal = uniquePhone();
  const phones = [demoCustomer, demoDriver, normal];
  const api = () => request(t.baseUrl);

  const requestCode = async (phone: string) => {
    await t.redis.del(`otp:cooldown:${phone}`);
    return api().post(`${OTP}/request`).send({ phone }).expect(202);
  };
  const verify = (phone: string, code: string, role: 'customer' | 'driver') =>
    api().post(`${OTP}/verify`).set('X-Client-Type', 'mobile').send({ phone, code, role });

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
    // Workers can be reused: never leak demo mode into other test files.
    delete process.env.DEMO_LOGIN_PHONES;
    delete process.env.DEMO_LOGIN_CODE;
  });

  it('signs the demo customer and demo driver in with the demo code, without any SMS', async () => {
    await requestCode(demoCustomer);
    await requestCode(demoDriver);
    expect(t.sms.sent.filter((m) => m.to === demoCustomer || m.to === demoDriver)).toEqual([]);

    const customer = await verify(demoCustomer, DEMO_CODE, 'customer').expect(200);
    expect(customer.body.user).toMatchObject({ phone: demoCustomer, role: 'customer' });
    const driver = await verify(demoDriver, DEMO_CODE, 'driver').expect(200);
    expect(driver.body.user).toMatchObject({ phone: demoDriver, role: 'driver' });

    // Roles stay separate: each token only opens its own side of the API.
    const asCustomer = `Bearer ${customer.body.accessToken as string}`;
    const asDriver = `Bearer ${driver.body.accessToken as string}`;
    await api().get('/api/v1/customers/me').set('Authorization', asCustomer).expect(200);
    await api().get('/api/v1/drivers/me').set('Authorization', asCustomer).expect(403);
    await api().get('/api/v1/drivers/me').set('Authorization', asDriver).expect(200);
    await api().get('/api/v1/customers/me').set('Authorization', asDriver).expect(403);
    await api().get('/api/v1/admin/overview').set('Authorization', asDriver).expect(403);

    const audit: { n: string }[] = await t.ds.query(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.demo_code_issued' AND created_at > now() - interval '1 minute'",
    );
    expect(Number(audit[0].n)).toBeGreaterThanOrEqual(2);
  });

  it('keeps the usual protections: wrong code counted, single use, customer number refused in the driver app', async () => {
    await requestCode(demoCustomer);
    const wrong = DEMO_CODE === '000001' ? '000002' : '000001';
    const bad = await verify(demoCustomer, wrong, 'customer').expect(401);
    expect(bad.body.message).toBe('Incorrect code. 4 attempts left.');
    await verify(demoCustomer, DEMO_CODE, 'customer').expect(200);
    await verify(demoCustomer, DEMO_CODE, 'customer').expect(400); // used

    await requestCode(demoCustomer);
    const crossApp = await verify(demoCustomer, DEMO_CODE, 'driver').expect(409);
    expect(crossApp.body.message).toContain('customer account');
  });

  it('never lets any other number in with the demo code; it still gets a real SMS code', async () => {
    await requestCode(normal);
    const code = t.sms.lastCode(normal); // the normal flow sent an SMS
    if (code !== DEMO_CODE) {
      await verify(normal, DEMO_CODE, 'customer').expect(401);
    }
    const ok = await verify(normal, code, 'customer').expect(200);
    expect(ok.body.user.phone).toBe(normal);
  });
});
