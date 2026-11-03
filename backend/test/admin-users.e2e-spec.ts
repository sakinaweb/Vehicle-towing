import request from 'supertest';
import { createTestApp, deleteUsersByPhone, signInAs, TestApp } from './support/test-app.js';

/** Admin customer management, account suspension and the settlement over-amount guard. */
describe('Admin users & settlement guard (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  const api = () => request(t.baseUrl);
  const verify = (phone: string, role: 'customer' | 'driver') =>
    api()
      .post('/api/v1/auth/otp/request')
      .send({ phone })
      .then(async () =>
        api()
          .post('/api/v1/auth/otp/verify')
          .send({ phone, code: t.sms.lastCode(phone), role }),
      );

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
  });

  it('lists customers; suspending signs them out and blocks sign-in until reactivated', async () => {
    const admin = await signInAs(t, 'admin', phones);
    const customer = await signInAs(t, 'customer', phones);

    const list = await api()
      .get(`/api/v1/admin/customers?q=${encodeURIComponent(customer.phone)}`)
      .set('Authorization', admin.token)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      phone: customer.phone,
      status: 'active',
      bookings: 0,
      spentFils: 0,
    });

    const suspended = await api()
      .post(`/api/v1/admin/users/${customer.userId}/suspend`)
      .set('Authorization', admin.token)
      .send({ reason: 'E2E: fake bookings' })
      .expect(200);
    expect(suspended.body).toMatchObject({ status: 'suspended', sessionsEnded: 1 });

    // Signed out at once (session revoked), and cannot sign in again.
    await api().get('/api/v1/customers/me').set('Authorization', customer.token).expect(401);
    await t.redis.del(`otp:cooldown:${customer.phone}`);
    const blocked = await verify(customer.phone, 'customer');
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toContain('not active');

    await api()
      .post(`/api/v1/admin/users/${customer.userId}/suspend`)
      .set('Authorization', admin.token)
      .send({ reason: 'again' })
      .expect(409);

    await api()
      .post(`/api/v1/admin/users/${customer.userId}/reactivate`)
      .set('Authorization', admin.token)
      .send({ reason: 'E2E: resolved' })
      .expect(200);
    await t.redis.del(`otp:cooldown:${customer.phone}`);
    expect((await verify(customer.phone, 'customer')).status).toBe(200);

    const audit: { action: string }[] = await t.ds.query(
      "SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE 'user.%' ORDER BY created_at",
      [customer.userId],
    );
    expect(audit.map((a) => a.action)).toEqual(['user.suspended', 'user.reactivated']);
  });

  it('never suspends admins or oneself; non-admins cannot use it; an online driver goes offline', async () => {
    const admin = await signInAs(t, 'admin', phones);
    const other = await signInAs(t, 'admin', phones);
    for (const id of [admin.userId, other.userId]) {
      await api()
        .post(`/api/v1/admin/users/${id}/suspend`)
        .set('Authorization', admin.token)
        .send({ reason: 'no' })
        .expect(400);
    }

    const driver = await signInAs(t, 'driver', phones);
    await api().get('/api/v1/admin/customers').set('Authorization', driver.token).expect(403);
    await t.ds.query("UPDATE drivers SET availability = 'online' WHERE user_id = $1", [
      driver.userId,
    ]);
    await api()
      .post(`/api/v1/admin/users/${driver.userId}/suspend`)
      .set('Authorization', admin.token)
      .send({ reason: 'E2E: documents expired' })
      .expect(200);
    const [{ availability }]: { availability: string }[] = await t.ds.query(
      'SELECT availability FROM drivers WHERE user_id = $1',
      [driver.userId],
    );
    expect(availability).toBe('offline');
  });

  it('refuses a settlement larger than what is owed unless explicitly confirmed', async () => {
    const admin = await signInAs(t, 'admin', phones);
    const driver = await signInAs(t, 'driver', phones);
    const [{ id: driverId }]: { id: string }[] = await t.ds.query(
      'SELECT id FROM drivers WHERE user_id = $1',
      [driver.userId],
    );
    const settle = (body: object) =>
      api()
        .post(`/api/v1/admin/drivers/${driverId}/settlements`)
        .set('Authorization', admin.token)
        .send(body);

    // Nothing is owed yet: a remittance would be a typo.
    const refused = await settle({
      direction: 'remittance',
      amountFils: 5000,
      reference: `G1-${driverId.slice(0, 8)}`,
    }).expect(409);
    expect(refused.body.message).toContain('more than the driver owes (AED 0.00)');

    const confirmed = await settle({
      direction: 'remittance',
      amountFils: 5000,
      reference: `G1-${driverId.slice(0, 8)}`,
      allowExceeding: true,
    }).expect(200);
    expect(confirmed.body.balanceFils).toBe(5000); // TowNow now owes the driver 50.00

    // Paying back exactly what is owed needs no confirmation; one fils more does.
    await settle({
      direction: 'payout',
      amountFils: 5001,
      reference: `G2-${driverId.slice(0, 8)}`,
    }).expect(409);
    const paid = await settle({
      direction: 'payout',
      amountFils: 5000,
      reference: `G2-${driverId.slice(0, 8)}`,
    }).expect(200);
    expect(paid.body.balanceFils).toBe(0);
  });
});
