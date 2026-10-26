import request from 'supertest';
import { FakeFcm } from './support/fake-fcm.js';
import type { TestApp } from './support/test-app.js';

/**
 * Operations features from the architecture plan: ratings, disputes, commission
 * settlement, admin job monitoring / cancellation, fare configuration, and
 * notifications (inbox + FCM push through BullMQ, against a local fake FCM).
 */
const fcm = new FakeFcm();
const fcmBase = await fcm.start();
const ENV = {
  PUSH_PROVIDER: 'fcm',
  FCM_PROJECT_ID: 'townow-e2e',
  FCM_CLIENT_EMAIL: 'push@townow-e2e.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: fcm.privateKeyPem.replace(/\n/g, '\\n'), // as a single-line .env value
  FCM_API_BASE: fcmBase,
  FCM_TOKEN_URI: `${fcmBase}/token`,
};
const previousEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
Object.assign(process.env, ENV); // config is validated when the app module is imported
const { createTestApp, deleteUsersByPhone, signInAs } = await import('./support/test-app.js');

type Point = { lat: number; lng: number };
const TOWN = {
  alQua: { lat: 23.53, lng: 55.48 },
  sweihan: { lat: 24.47, lng: 55.34 },
  mezaira: { lat: 23.14, lng: 53.79 },
} as const;
const north = (p: Point, km: number): Point => ({ lat: p.lat + km / 111, lng: p.lng });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF')]);
const CHECKLIST = {
  body: 'ok',
  glass: 'ok',
  lights: 'ok',
  tyres: 'ok',
  mirrors: 'ok',
  interior: 'ok',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  ms = 10_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(150);
  }
}

describe('Operations: ratings, disputes, settlements, admin, push (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  const api = () => request(t.baseUrl);
  type Who = { token: string; userId: string };
  let admin: Who;

  async function onlineDriver(at: Point) {
    const d = await signInAs(t, 'driver', phones);
    const [{ id: driverId }]: { id: string }[] = await t.ds.query(
      'SELECT id FROM drivers WHERE user_id = $1',
      [d.userId],
    );
    await t.ds.query("UPDATE drivers SET kyc_status = 'approved' WHERE id = $1", [driverId]);
    await api()
      .post('/api/v1/drivers/me/tow-trucks')
      .set('Authorization', d.token)
      .send({
        towType: 'flatbed',
        model: 'Isuzu NPR',
        year: 2023,
        plateEmirate: 'Abu Dhabi',
        plateCode: '7',
        plateNumber: String(10_000 + Math.floor(Math.random() * 89_999)),
      })
      .expect(201);
    await api()
      .put('/api/v1/drivers/me/availability')
      .set('Authorization', d.token)
      .send({ status: 'online' })
      .expect(200);
    await api()
      .post('/api/v1/drivers/me/location')
      .set('Authorization', d.token)
      .send(at)
      .expect(200);
    return { ...d, driverId };
  }

  async function book(pickup: Point) {
    const c = await signInAs(t, 'customer', phones);
    const vehicle = await api()
      .post('/api/v1/customers/me/vehicles')
      .set('Authorization', c.token)
      .send({
        category: 'car',
        brand: 'Nissan',
        model: 'Patrol',
        year: 2021,
        plateEmirate: 'Abu Dhabi',
        plateCode: '2',
        plateNumber: String(10_000 + Math.floor(Math.random() * 89_999)),
      })
      .expect(201);
    const quote = await api()
      .post('/api/v1/bookings/quotes')
      .set('Authorization', c.token)
      .send({
        vehicleId: vehicle.body.id,
        towType: 'flatbed',
        pickup: { ...pickup, address: 'Ops test pickup' },
        dropoff: { ...north(pickup, 5), address: 'Ops test garage' },
      })
      .expect(200);
    const booking = await api()
      .post('/api/v1/bookings')
      .set('Authorization', c.token)
      .send({ quoteId: quote.body.quoteId, issue: 'Breakdown', paymentMethod: 'cash' })
      .expect(201);
    return {
      customer: c,
      bookingId: booking.body.id as string,
      number: booking.body.bookingNumber as string,
    };
  }

  /** Driver accepts the offer and runs the trip up to (and including) `until`. */
  async function drive(driver: Who, bookingId: string, until: 'arrived' | 'complete') {
    const offer = await waitFor(async () => {
      const o = (
        await api().get('/api/v1/drivers/me/offers/current').set('Authorization', driver.token)
      ).body.offer as { offerId: string; bookingId: string } | null;
      return o?.bookingId === bookingId ? o : null;
    });
    await api()
      .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
      .set('Authorization', driver.token)
      .expect(200);
    const step = (name: string) =>
      api()
        .post(`/api/v1/drivers/me/jobs/${bookingId}/${name}`)
        .set('Authorization', driver.token)
        .expect(200);
    const inspect = async (stage: string, km: number) => {
      await api()
        .put(`/api/v1/drivers/me/jobs/${bookingId}/inspections/${stage}`)
        .set('Authorization', driver.token)
        .send({ odometerKm: km, fuelLevel: 'half', checklist: CHECKLIST })
        .expect(200);
      for (const slot of ['front', 'back', 'left', 'right']) {
        await api()
          .post(`/api/v1/drivers/me/jobs/${bookingId}/inspections/${stage}/photos`)
          .set('Authorization', driver.token)
          .field('slot', slot)
          .attach('file', JPEG, { filename: `${slot}.jpg`, contentType: 'image/jpeg' })
          .expect(201);
      }
      await api()
        .post(`/api/v1/drivers/me/jobs/${bookingId}/inspections/${stage}/submit`)
        .set('Authorization', driver.token)
        .expect(200);
    };
    await step('en-route');
    await step('arrived');
    if (until === 'arrived') return;
    await inspect('pickup', 500);
    await step('start-tow');
    await inspect('return', 505);
    await step('complete');
  }

  beforeAll(async () => {
    t = await createTestApp();
    admin = await signInAs(t, 'admin', phones);
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
    await fcm.stop();
    for (const [k, v] of Object.entries(previousEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('pushes offers and trip updates to registered devices, stores them in the inbox, drops dead tokens', async () => {
    const driver = await onlineDriver(TOWN.alQua);
    const driverToken = `drv-${driver.userId}-fcm-token-000000`;
    await api()
      .put('/api/v1/me/devices')
      .set('Authorization', driver.token)
      .send({ token: driverToken, platform: 'android' })
      .expect(204);
    // Re-registering is idempotent; invalid platforms are refused.
    await api()
      .put('/api/v1/me/devices')
      .set('Authorization', driver.token)
      .send({ token: driverToken, platform: 'android' })
      .expect(204);
    await api()
      .put('/api/v1/me/devices')
      .set('Authorization', driver.token)
      .send({ token: driverToken, platform: 'nokia' })
      .expect(400);
    await api()
      .put('/api/v1/me/devices')
      .send({ token: driverToken, platform: 'android' })
      .expect(401);

    const { customer, bookingId } = await book(north(TOWN.alQua, 1));
    const customerToken = `cus-${customer.userId}-fcm-token-00000`;
    const deadToken = `dead-${customer.userId}-uninstalled-app`;
    for (const token of [customerToken, deadToken]) {
      await api()
        .put('/api/v1/me/devices')
        .set('Authorization', customer.token)
        .send({ token, platform: 'ios' })
        .expect(204);
    }

    const offerPush = await waitFor(() =>
      fcm.to(driverToken).find((p) => p.data.type === 'offer.new'),
    );
    expect(offerPush.notification.title).toBe('New tow request');
    expect(offerPush.data.bookingId).toBe(bookingId);

    await drive(driver, bookingId, 'arrived');
    await waitFor(() =>
      fcm.to(customerToken).find((p) => p.data.type === 'booking.driver_arrived'),
    );
    const pushed = fcm.to(customerToken).map((p) => p.data.type);
    expect(pushed).toEqual(
      expect.arrayContaining([
        'booking.driver_assigned',
        'booking.driver_arriving',
        'booking.driver_arrived',
      ]),
    );
    // The uninstalled app's token was removed after FCM answered UNREGISTERED.
    await waitFor(async () => {
      const rows: unknown[] = await t.ds.query('SELECT 1 FROM device_tokens WHERE token = $1', [
        deadToken,
      ]);
      return rows.length === 0;
    });

    // Inbox: newest first, unread count, mark read.
    const inbox = await api()
      .get('/api/v1/me/notifications')
      .set('Authorization', customer.token)
      .expect(200);
    expect(inbox.body.items[0]).toMatchObject({
      type: 'booking.driver_arrived',
      title: 'Driver has arrived',
      readAt: null,
    });
    expect(inbox.body.unread).toBeGreaterThanOrEqual(3);
    await api()
      .post(`/api/v1/me/notifications/${inbox.body.items[0].id}/read`)
      .set('Authorization', customer.token)
      .expect(204);
    // Someone else's notification is not found.
    await api()
      .post(`/api/v1/me/notifications/${inbox.body.items[1].id}/read`)
      .set('Authorization', driver.token)
      .expect(404);
    await api()
      .post('/api/v1/me/notifications/read-all')
      .set('Authorization', customer.token)
      .expect(204);
    expect(
      (await api().get('/api/v1/me/notifications').set('Authorization', customer.token)).body
        .unread,
    ).toBe(0);

    await api()
      .delete('/api/v1/me/devices')
      .set('Authorization', driver.token)
      .send({ token: driverToken })
      .expect(204);
    const left: unknown[] = await t.ds.query('SELECT 1 FROM device_tokens WHERE token = $1', [
      driverToken,
    ]);
    expect(left).toHaveLength(0);

    // Admin cancels the stuck job on scene: driver released, customer notified.
    const detail = await api()
      .get(`/api/v1/admin/bookings/${bookingId}`)
      .set('Authorization', admin.token)
      .expect(200);
    expect(detail.body.summary).toMatchObject({
      status: 'driver_arrived',
      driverId: driver.driverId,
    });
    expect(detail.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      'requested',
      'searching',
      'driver_assigned',
      'driver_arriving',
      'driver_arrived',
    ]);
    // The customer can no longer cancel on scene; operations can.
    await api()
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', customer.token)
      .send({ reason: 'Changed my mind' })
      .expect(409);
    await api()
      .post(`/api/v1/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', customer.token)
      .send({ reason: 'Not allowed' })
      .expect(403);
    const cancelled = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', admin.token)
      .send({ reason: 'Customer phoned support: vehicle started' })
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelledBy: 'admin' });
    await api()
      .post(`/api/v1/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', admin.token)
      .send({ reason: 'Again please' })
      .expect(409);
    const [{ availability }]: { availability: string }[] = await t.ds.query(
      'SELECT availability FROM drivers WHERE id = $1',
      [driver.driverId],
    );
    expect(availability).toBe('online');
    await waitFor(() => fcm.to(customerToken).find((p) => p.data.type === 'booking.cancelled'));
  });

  it('rates a completed tow once and updates the driver average; raises and resolves disputes', async () => {
    const driver = await onlineDriver(TOWN.sweihan);
    const { customer, bookingId, number } = await book(north(TOWN.sweihan, 1));

    // Not rateable / disputable before a driver is involved.
    await api()
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set('Authorization', customer.token)
      .send({ rating: 5 })
      .expect(409);
    await drive(driver, bookingId, 'complete');

    const stranger = await signInAs(t, 'customer', phones);
    await api()
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set('Authorization', stranger.token)
      .send({ rating: 1 })
      .expect(404);
    await api()
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set('Authorization', customer.token)
      .send({ rating: 6 })
      .expect(400);
    const rated = await api()
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set('Authorization', customer.token)
      .send({ rating: 4, comment: 'Careful loading, a little late.' })
      .expect(200);
    expect(rated.body.myRating).toMatchObject({
      rating: 4,
      comment: 'Careful loading, a little late.',
    });
    await api()
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set('Authorization', customer.token)
      .send({ rating: 5 })
      .expect(409);
    const [{ rating }]: { rating: string }[] = await t.ds.query(
      'SELECT rating FROM drivers WHERE id = $1',
      [driver.driverId],
    );
    expect(Number(rating)).toBe(4);

    // Disputes: participants only, one open at a time, decided by operations.
    await api()
      .post(`/api/v1/bookings/${bookingId}/disputes`)
      .set('Authorization', stranger.token)
      .send({ reason: 'I was not even there at all' })
      .expect(404);
    await api()
      .post(`/api/v1/bookings/${bookingId}/disputes`)
      .set('Authorization', customer.token)
      .send({ reason: 'short' })
      .expect(400);
    const raised = await api()
      .post(`/api/v1/bookings/${bookingId}/disputes`)
      .set('Authorization', customer.token)
      .send({ reason: 'Rear bumper scratched during loading.' })
      .expect(201);
    expect(raised.body).toMatchObject({
      status: 'open',
      bookingNumber: number,
      raisedByRole: 'customer',
    });
    await api()
      .post(`/api/v1/bookings/${bookingId}/disputes`)
      .set('Authorization', driver.token)
      .send({ reason: 'The scratch was there before pickup (see photos).' })
      .expect(409);
    await api().get('/api/v1/admin/disputes').set('Authorization', customer.token).expect(403);
    const open = await api()
      .get('/api/v1/admin/disputes')
      .set('Authorization', admin.token)
      .expect(200);
    expect(open.body.map((d: { id: string }) => d.id)).toContain(raised.body.id);
    const resolved = await api()
      .post(`/api/v1/admin/disputes/${raised.body.id}/resolve`)
      .set('Authorization', admin.token)
      .send({ status: 'rejected', resolution: 'Pickup photos show the scratch before loading.' })
      .expect(200);
    expect(resolved.body).toMatchObject({
      status: 'rejected',
      resolution: 'Pickup photos show the scratch before loading.',
    });
    await api()
      .post(`/api/v1/admin/disputes/${raised.body.id}/resolve`)
      .set('Authorization', admin.token)
      .send({ status: 'resolved', resolution: 'Changed my mind' })
      .expect(409);
    const mine = await api()
      .get('/api/v1/me/disputes')
      .set('Authorization', customer.token)
      .expect(200);
    expect(mine.body[0]).toMatchObject({ id: raised.body.id, status: 'rejected' });
    await waitFor(async () => {
      const inbox = await api()
        .get('/api/v1/me/notifications')
        .set('Authorization', customer.token);
      return inbox.body.items.find((n: { type: string }) => n.type === 'dispute.rejected');
    });
  });

  it('settles cash-trip commission with idempotent remittances; admin overview, job list and fares', async () => {
    const driver = await onlineDriver(TOWN.mezaira);
    const { bookingId, number } = await book(north(TOWN.mezaira, 1));

    // Job list: open jobs, searchable by booking number.
    const listed = await waitFor(async () => {
      const res = await api()
        .get(`/api/v1/admin/bookings?q=${number}`)
        .set('Authorization', admin.token)
        .expect(200);
      return res.body.items[0] as { bookingNumber: string } | undefined;
    });
    expect(listed.bookingNumber).toBe(number);
    await api()
      .get('/api/v1/admin/bookings?status=bogus')
      .set('Authorization', admin.token)
      .expect(400);

    await drive(driver, bookingId, 'complete');
    const invoice = await api()
      .get(`/api/v1/bookings/${bookingId}/invoice`)
      .set('Authorization', driver.token)
      .expect(200);
    await api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
      .set('Authorization', driver.token)
      .send({ amountFils: invoice.body.totalFils })
      .expect(200);
    const owed = (await api().get('/api/v1/drivers/me/earnings').set('Authorization', driver.token))
      .body.balanceFils as number;
    expect(owed).toBeLessThan(0);

    const balances = await api()
      .get('/api/v1/admin/commissions')
      .set('Authorization', admin.token)
      .expect(200);
    expect(
      balances.body.find((b: { driverId: string }) => b.driverId === driver.driverId),
    ).toMatchObject({
      balanceFils: owed,
      completedTrips: 1,
      lastSettlementAt: null,
    });

    const reference = `E2E-${driver.driverId.slice(0, 8)}`;
    const settle = (body: object, token = admin.token) =>
      api()
        .post(`/api/v1/admin/drivers/${driver.driverId}/settlements`)
        .set('Authorization', token)
        .send(body);
    await settle({ direction: 'remittance', amountFils: -owed, reference }, driver.token).expect(
      403,
    );
    await settle({ direction: 'remittance', amountFils: 0, reference }).expect(400);
    const after = await settle({ direction: 'remittance', amountFils: -owed, reference }).expect(
      200,
    );
    expect(after.body.balanceFils).toBe(0);
    expect(after.body.entries[0]).toMatchObject({
      type: 'remittance',
      amountFils: -owed,
      bookingId: null,
      reference,
    });
    // Same transfer submitted twice → no double posting; a different amount under it → refused.
    expect(
      (await settle({ direction: 'remittance', amountFils: -owed, reference }).expect(200)).body
        .balanceFils,
    ).toBe(0);
    await settle({ direction: 'remittance', amountFils: 1, reference }).expect(409);
    expect(
      (await api().get('/api/v1/drivers/me/earnings').set('Authorization', driver.token)).body
        .balanceFils,
    ).toBe(0);

    const overview = await api()
      .get('/api/v1/admin/overview')
      .set('Authorization', admin.token)
      .expect(200);
    expect(overview.body).toMatchObject({
      driversOnline: expect.any(Number),
      openDisputes: expect.any(Number),
      completedToday: expect.any(Number),
      commissionOwedFils: expect.any(Number),
    });
    expect(overview.body.completedToday).toBeGreaterThanOrEqual(1);
    // All-time totals are consistent: completed + cancelled ≤ total; VAT and commission ≤ gross.
    const o = overview.body;
    expect(o.completedBookings + o.cancelledBookings).toBeLessThanOrEqual(o.totalBookings);
    expect(o.completedBookings).toBeGreaterThanOrEqual(1);
    expect(o.vatAllTimeFils).toBeLessThan(o.grossAllTimeFils);
    expect(o.commissionEarnedFils).toBeGreaterThan(0);
    expect(o.commissionEarnedFils).toBeLessThan(o.grossAllTimeFils);

    // The driver list shows availability (for "online now" in the console).
    const approved = await api()
      .get('/api/v1/admin/drivers?kycStatus=approved&limit=50')
      .set('Authorization', admin.token)
      .expect(200);
    expect(
      approved.body.items.find((d: { driverId: string }) => d.driverId === driver.driverId),
    ).toMatchObject({ availability: expect.stringMatching(/online|offline|busy|en_route/) });
  });

  it('tells customers how many trucks are nearby — counts and coarse distance only', async () => {
    const ruwais = { lat: 24.11, lng: 52.73 };
    const customer = await signInAs(t, 'customer', phones);
    const near = (p: Point, token = customer.token) =>
      api()
        .get(`/api/v1/availability/nearby?lat=${p.lat}&lng=${p.lng}`)
        .set('Authorization', token);

    const before = (await near(ruwais).expect(200)).body;
    const flatbedBefore = before.byTowType.find(
      (x: { towType: string }) => x.towType === 'flatbed',
    );

    const driver = await onlineDriver(north(ruwais, 1.2)); // ~1.2 km away
    const after = (await near(ruwais).expect(200)).body;
    const flatbed = after.byTowType.find((x: { towType: string }) => x.towType === 'flatbed');
    expect(flatbed.available).toBe(flatbedBefore.available + 1);
    expect(flatbed.nearestMeters % 500).toBe(0); // rounded, never exact
    expect(flatbed.nearestMeters).toBeGreaterThanOrEqual(1000);
    expect(JSON.stringify(after)).not.toMatch(/"lat"|"lng"|driverId|phone|POINT/);
    expect(after.radiusMeters).toBeGreaterThan(0);

    await near(ruwais, driver.token).expect(403); // customers only
    await api().get(`/api/v1/availability/nearby?lat=${ruwais.lat}&lng=${ruwais.lng}`).expect(401);
    await near({ lat: 123, lng: 52.73 }).expect(400);
    // Offline drivers are not counted.
    await api()
      .put('/api/v1/drivers/me/availability')
      .set('Authorization', driver.token)
      .send({ status: 'offline' })
      .expect(200);
    const off = (await near(ruwais).expect(200)).body.byTowType.find(
      (x: { towType: string }) => x.towType === 'flatbed',
    );
    expect(off.available).toBe(flatbedBefore.available);
  });

  it('publishes a new fare version without touching existing bookings (admin only)', async () => {
    const current = (await api().get('/api/v1/pricing/tariffs').expect(200)).body.find(
      (x: { towType: string }) => x.towType === 'bike-carrier',
    );
    const versions = await api()
      .get('/api/v1/admin/pricing-rules')
      .set('Authorization', admin.token)
      .expect(200);
    const active = versions.body.find(
      (v: { towType: string; effectiveTo: string | null }) =>
        v.towType === 'bike-carrier' && !v.effectiveTo,
    );
    const original = {
      towType: 'bike-carrier',
      baseFareFils: active.baseFareFils,
      perKmFils: active.perKmFils,
      minimumFareFils: active.minimumFareFils,
      towTypeSurchargeFils: active.towTypeSurchargeFils,
      nightSurchargeFils: active.nightSurchargeFils,
      platformCommissionBps: active.platformCommissionBps,
    };
    await api().post('/api/v1/admin/pricing-rules').send(original).expect(401);
    await api()
      .post('/api/v1/admin/pricing-rules')
      .set('Authorization', admin.token)
      .send({ ...original, platformCommissionBps: 9000 })
      .expect(400);
    try {
      const published = await api()
        .post('/api/v1/admin/pricing-rules')
        .set('Authorization', admin.token)
        .send({ ...original, baseFareFils: original.baseFareFils + 100 })
        .expect(201);
      expect(published.body).toMatchObject({
        towType: 'bike-carrier',
        effectiveTo: null,
        vatRateBps: current.vatRateBps,
      });
      const now = (await api().get('/api/v1/pricing/tariffs').expect(200)).body.find(
        (x: { towType: string }) => x.towType === 'bike-carrier',
      );
      expect(now.baseFareFils).toBe(original.baseFareFils + 100);
      const [{ effective_to }]: { effective_to: Date | null }[] = await t.ds.query(
        'SELECT effective_to FROM pricing_rules WHERE id = $1',
        [active.id],
      );
      expect(effective_to).not.toBeNull();
    } finally {
      // Restore the dev tariff (the e2e suite shares the dev database).
      await api()
        .post('/api/v1/admin/pricing-rules')
        .set('Authorization', admin.token)
        .send(original)
        .expect(201);
    }
  });
});
