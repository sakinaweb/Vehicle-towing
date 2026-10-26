import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp, deleteUsersByPhone, signInAs, TestApp } from './support/test-app.js';

/**
 * Matching runs for real: PostGIS candidate search, BullMQ jobs (offer timeout
 * 2 s, retry 1 s — see vitest.config.e2e.ts) and Socket.IO events. Each scenario
 * uses its own city (> 15 km apart) so drivers from one test never match another.
 */
const CITY = {
  marina: { lat: 25.08, lng: 55.14 },
  deira: { lat: 25.27, lng: 55.31 },
  abuDhabi: { lat: 24.47, lng: 54.37 },
  alAin: { lat: 24.21, lng: 55.74 },
  rak: { lat: 25.79, lng: 55.94 },
  fujairah: { lat: 25.13, lng: 56.33 },
  ruwais: { lat: 24.11, lng: 52.73 },
  madinatZayed: { lat: 23.68, lng: 53.7 },
  ummAlQuwain: { lat: 25.56, lng: 55.55 },
  hatta: { lat: 24.8, lng: 56.12 },
  liwa: { lat: 23.13, lng: 53.79 },
} as const;
type Point = { lat: number; lng: number };
const north = (p: Point, km: number): Point => ({ lat: p.lat + km / 111, lng: p.lng });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
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

describe('Dispatch: availability, location & matching (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  const sockets: Socket[] = [];
  const api = () => request(t.baseUrl);

  interface DriverHandle {
    token: string;
    userId: string;
    driverId: string;
  }

  /** A KYC-approved driver with one active truck, online at `at`. */
  async function onlineDriver(
    at: Point,
    opts: { towType?: string; online?: boolean; approved?: boolean } = {},
  ): Promise<DriverHandle> {
    const d = await signInAs(t, 'driver', phones);
    const [{ id: driverId }]: { id: string }[] = await t.ds.query(
      'SELECT id FROM drivers WHERE user_id = $1',
      [d.userId],
    );
    // KYC review is an admin feature (later phase); approve directly for the test.
    if (opts.approved !== false) {
      await t.ds.query("UPDATE drivers SET kyc_status = 'approved' WHERE id = $1", [driverId]);
    }
    await api()
      .post('/api/v1/drivers/me/tow-trucks')
      .set('Authorization', d.token)
      .send({
        towType: opts.towType ?? 'flatbed',
        model: 'Isuzu NPR',
        year: 2023,
        plateEmirate: 'Dubai',
        plateCode: 'T',
        plateNumber: String(10_000 + Math.floor(Math.random() * 89_999)),
      })
      .expect(201);
    if (opts.online !== false) {
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
    }
    return { token: d.token, userId: d.userId, driverId };
  }

  /** A customer with a car, booking a tow from `pickup`. Returns the booking. */
  async function book(pickup: Point, towType = 'flatbed') {
    const c = await signInAs(t, 'customer', phones);
    const vehicle = await api()
      .post('/api/v1/customers/me/vehicles')
      .set('Authorization', c.token)
      .send({
        category: towType === 'bike-carrier' ? 'motorbike' : 'car',
        brand: 'Nissan',
        model: 'Patrol',
        year: 2022,
        plateEmirate: 'Dubai',
        plateCode: 'C',
        plateNumber: String(10_000 + Math.floor(Math.random() * 89_999)),
      })
      .expect(201);
    const quote = await api()
      .post('/api/v1/bookings/quotes')
      .set('Authorization', c.token)
      .send({
        vehicleId: vehicle.body.id,
        towType,
        pickup: { ...pickup, address: 'Pickup for test' },
        dropoff: { ...north(pickup, 6), address: 'Garage for test' },
      })
      .expect(200);
    const booking = await api()
      .post('/api/v1/bookings')
      .set('Authorization', c.token)
      .send({ quoteId: quote.body.quoteId, issue: 'Breakdown', paymentMethod: 'cash' })
      .expect(201);
    return { customer: c, bookingId: booking.body.id as string };
  }

  const currentOffer = async (d: DriverHandle) =>
    (await api().get('/api/v1/drivers/me/offers/current').set('Authorization', d.token).expect(200))
      .body.offer as { offerId: string; bookingId: string; distanceToPickupMeters: number } | null;

  const waitForOffer = (d: DriverHandle, bookingId: string, ms?: number) =>
    waitFor(async () => {
      const o = await currentOffer(d);
      return o && o.bookingId === bookingId ? o : null;
    }, ms);

  const getBooking = async (token: string, id: string) =>
    (await api().get(`/api/v1/bookings/${id}`).set('Authorization', token).expect(200)).body;

  function connect(token: string): Promise<Socket> {
    const socket = io(`${t.baseUrl}/realtime`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token },
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
  });

  // ------------------------------------------------------------------ availability

  describe('availability', () => {
    it('only lets approved drivers with an active truck go online', async () => {
      const pending = await onlineDriver(CITY.liwa, { approved: false, online: false });
      const res = await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', pending.token)
        .send({ status: 'online' })
        .expect(409);
      expect(res.body.message).toMatch(/pending verification/);

      const noTruck = await signInAs(t, 'driver', phones);
      await t.ds.query("UPDATE drivers SET kyc_status = 'approved' WHERE user_id = $1", [
        noTruck.userId,
      ]);
      const res2 = await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', noTruck.token)
        .send({ status: 'online' })
        .expect(409);
      expect(res2.body.message).toBe('Register an active tow truck before going online.');
    });

    it('goes online and offline, and refuses states only dispatch may set', async () => {
      const d = await onlineDriver(CITY.liwa, { online: false });
      const on = await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', d.token)
        .send({ status: 'online' })
        .expect(200);
      expect(on.body.availability).toBe('online');
      await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', d.token)
        .send({ status: 'busy' })
        .expect(400);
      const off = await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', d.token)
        .send({ status: 'offline' })
        .expect(200);
      expect(off.body.availability).toBe('offline');
      const get = await api().get('/api/v1/drivers/me/availability').set('Authorization', d.token);
      expect(get.body.availability).toBe('offline');
    });

    it('is only for the signed-in driver', async () => {
      const c = await signInAs(t, 'customer', phones);
      await api().put('/api/v1/drivers/me/availability').send({ status: 'online' }).expect(401);
      await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', c.token)
        .send({ status: 'online' })
        .expect(403);
    });
  });

  // ------------------------------------------------------------------ location

  describe('location', () => {
    it('stores the position in PostGIS and the latest fix in Redis', async () => {
      const d = await onlineDriver(CITY.liwa);
      const at = north(CITY.liwa, 1);
      await api()
        .post('/api/v1/drivers/me/location')
        .set('Authorization', d.token)
        .send({ ...at, accuracyMeters: 8, headingDegrees: 90 })
        .expect(200);
      const [row]: { lat: number; lng: number }[] = await t.ds.query(
        `SELECT ST_Y(current_location::geometry) AS lat, ST_X(current_location::geometry) AS lng
           FROM drivers WHERE id = $1`,
        [d.driverId],
      );
      expect(row.lat).toBeCloseTo(at.lat, 6);
      expect(row.lng).toBeCloseTo(at.lng, 6);
      const cached = JSON.parse((await t.redis.get(`driver:location:${d.driverId}`))!);
      expect(cached).toMatchObject({ ...at, accuracyMeters: 8, headingDegrees: 90 });
    });

    it('rejects invalid coordinates, stale, future and out-of-order fixes', async () => {
      const d = await onlineDriver(CITY.liwa);
      const post = (body: object) =>
        api().post('/api/v1/drivers/me/location').set('Authorization', d.token).send(body);

      const bad = await post({ lat: 91, lng: 181 }).expect(400);
      expect(bad.body.message).toEqual(
        expect.arrayContaining([
          'lat must be a latitude string or number',
          'lng must be a longitude string or number',
        ]),
      );
      const stale = await post({
        ...CITY.liwa,
        recordedAt: new Date(Date.now() - 180_000).toISOString(),
      }).expect(400);
      expect(stale.body.message).toBe('Location is older than 120 seconds and was not saved.');
      const future = await post({
        ...CITY.liwa,
        recordedAt: new Date(Date.now() + 120_000).toISOString(),
      }).expect(400);
      expect(future.body.message).toMatch(/in the future/);

      await post({ ...CITY.liwa, recordedAt: new Date().toISOString() }).expect(200);
      const older = await post({
        ...CITY.liwa,
        recordedAt: new Date(Date.now() - 5_000).toISOString(),
      }).expect(409);
      expect(older.body.message).toBe('A newer location is already recorded.');
    });

    it('never takes the driver from the request, and offline drivers are not tracked', async () => {
      const d = await onlineDriver(CITY.liwa);
      const other = await onlineDriver(CITY.liwa);
      const res = await api()
        .post('/api/v1/drivers/me/location')
        .set('Authorization', d.token)
        .send({ ...CITY.liwa, driverId: other.driverId })
        .expect(400);
      expect(res.body.message).toContain('property driverId should not exist');

      await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', d.token)
        .send({ status: 'offline' })
        .expect(200);
      expect(await t.redis.get(`driver:location:${d.driverId}`)).toBeNull();
      await api()
        .post('/api/v1/drivers/me/location')
        .set('Authorization', d.token)
        .send(CITY.liwa)
        .expect(409);

      const c = await signInAs(t, 'customer', phones);
      await api()
        .post('/api/v1/drivers/me/location')
        .set('Authorization', c.token)
        .send(CITY.liwa)
        .expect(403);
    });

    it('accepts locations over Socket.IO from drivers only', async () => {
      const d = await onlineDriver(CITY.liwa);
      const socket = await connect(d.token);
      const at = north(CITY.liwa, 2);
      const ack = await socket.emitWithAck('driver:location', {
        ...at,
        recordedAt: new Date().toISOString(),
      });
      expect(ack).toEqual({ ok: true });
      const [row]: { lat: number }[] = await t.ds.query(
        'SELECT ST_Y(current_location::geometry) AS lat FROM drivers WHERE id = $1',
        [d.driverId],
      );
      expect(row.lat).toBeCloseTo(at.lat, 6);

      const bad = await socket.emitWithAck('driver:location', { lat: 200, lng: 0 });
      expect(bad).toMatchObject({ ok: false });

      const c = await signInAs(t, 'customer', phones);
      const customerSocket = await connect(c.token);
      expect(await customerSocket.emitWithAck('driver:location', at)).toEqual({
        ok: false,
        error: 'forbidden',
      });
    });
  });

  // ------------------------------------------------------------------ matching

  describe('matching', () => {
    it('offers the job to the nearest eligible driver only (PostGIS, capability, freshness)', async () => {
      const pickup = CITY.marina;
      const eligible = await onlineDriver(north(pickup, 3));
      const wrongTruck = await onlineDriver(north(pickup, 1), { towType: 'wheel-lift' });
      const stale = await onlineDriver(north(pickup, 0.5));
      await t.ds.query(
        "UPDATE drivers SET location_updated_at = now() - interval '10 minutes' WHERE id = $1",
        [stale.driverId],
      );
      const offline = await onlineDriver(north(pickup, 0.2));
      await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', offline.token)
        .send({ status: 'offline' })
        .expect(200);
      const tooFar = await onlineDriver(north(pickup, 20)); // outside the 15 km radius

      const { bookingId } = await book(pickup);
      const offer = await waitForOffer(eligible, bookingId);
      expect(offer.distanceToPickupMeters).toBeGreaterThan(2_800);
      expect(offer.distanceToPickupMeters).toBeLessThan(3_200);

      for (const d of [wrongTruck, stale, offline, tooFar]) {
        expect(await currentOffer(d)).toBeNull();
      }
      const offers: { count: string }[] = await t.ds.query(
        'SELECT count(*) FROM booking_offers WHERE booking_id = $1',
        [bookingId],
      );
      expect(Number(offers[0].count)).toBe(1); // one offer per attempt, no duplicates
    });

    it('assigns the booking on accept and tells the customer in real time', async () => {
      const pickup = CITY.deira;
      const driver = await onlineDriver(north(pickup, 2));
      const driverSocket = await connect(driver.token);
      const offerEvent = new Promise<{ bookingId: string; customerFirstName: string }>((r) =>
        driverSocket.once('offer:new', r),
      );

      const { bookingId, customer } = await book(pickup);
      const customerSocket = await connect(customer.token);
      const updates: { bookingId: string; status: string }[] = [];
      customerSocket.on('booking:updated', (e: { bookingId: string; status: string }) =>
        updates.push(e),
      );

      const pushed = await offerEvent; // delivered over Socket.IO
      expect(pushed.bookingId).toBe(bookingId);
      expect(JSON.stringify(pushed)).not.toMatch(/\+971/); // no customer phone in the offer

      const offer = await waitForOffer(driver, bookingId);
      const accepted = await api()
        .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
        .set('Authorization', driver.token)
        .expect(200);
      expect(accepted.body).toMatchObject({ bookingId, status: 'driver_assigned' });

      await waitFor(() => Promise.resolve(updates.some((u) => u.status === 'driver_assigned')));
      const view = await getBooking(customer.token, bookingId);
      expect(view.status).toBe('driver_assigned');
      expect(view.driver).toMatchObject({ truck: { towType: 'flatbed', plateCode: 'T' } });
      expect(JSON.stringify(view.driver)).not.toMatch(/\+971|phone/i);
      expect(
        (await api().get('/api/v1/drivers/me/availability').set('Authorization', driver.token)).body
          .availability,
      ).toBe('busy');

      // Idempotent: accepting again returns the same job.
      const again = await api()
        .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
        .set('Authorization', driver.token)
        .expect(200);
      expect(again.body.bookingId).toBe(bookingId);

      // Busy drivers can't go offline mid-job, then start driving: customer sees "en route".
      await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', driver.token)
        .send({ status: 'offline' })
        .expect(409);
      const job = await api()
        .get('/api/v1/drivers/me/jobs/current')
        .set('Authorization', driver.token)
        .expect(200);
      expect(job.body.job.bookingId).toBe(bookingId);
      await api()
        .post(`/api/v1/drivers/me/jobs/${bookingId}/en-route`)
        .set('Authorization', driver.token)
        .expect(200);
      await waitFor(() => Promise.resolve(updates.some((u) => u.status === 'driver_arriving')));
      expect((await getBooking(customer.token, bookingId)).status).toBe('driver_arriving');
    });

    it('moves to the next driver when the first declines', async () => {
      const pickup = CITY.abuDhabi;
      const first = await onlineDriver(north(pickup, 1));
      const second = await onlineDriver(north(pickup, 4));
      const { bookingId } = await book(pickup);

      const offer = await waitForOffer(first, bookingId);
      await api()
        .post(`/api/v1/drivers/me/offers/${offer.offerId}/decline`)
        .set('Authorization', first.token)
        .expect(204);
      const next = await waitForOffer(second, bookingId);
      expect(next.offerId).not.toBe(offer.offerId);
      // A declined offer can't be accepted afterwards.
      await api()
        .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
        .set('Authorization', first.token)
        .expect(409);
    });

    it('expires an unanswered offer and retries with the next driver', async () => {
      const pickup = CITY.alAin;
      const slow = await onlineDriver(north(pickup, 1));
      const backup = await onlineDriver(north(pickup, 5));
      const { bookingId, customer } = await book(pickup);

      const offer = await waitForOffer(slow, bookingId);
      await waitForOffer(backup, bookingId, 8_000); // after the 2 s timeout (BullMQ delayed job)
      const [row]: { status: string }[] = await t.ds.query(
        'SELECT status FROM booking_offers WHERE id = $1',
        [offer.offerId],
      );
      expect(row.status).toBe('expired');
      const late = await api()
        .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
        .set('Authorization', slow.token)
        .expect(409);
      expect(late.body.message).toBe('This job offer is no longer available.');
      expect((await getBooking(customer.token, bookingId)).status).toBe('searching');
    });

    it('lets exactly one driver win when accepts race', async () => {
      const pickup = CITY.rak;
      const winner = await onlineDriver(north(pickup, 1));
      const intruder = await onlineDriver(north(pickup, 2));
      const { bookingId } = await book(pickup);
      const offer = await waitForOffer(winner, bookingId);

      const results = await Promise.all([
        ...[1, 2, 3].map(() =>
          api()
            .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
            .set('Authorization', winner.token),
        ),
        api()
          .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
          .set('Authorization', intruder.token),
      ]);
      expect(results.slice(0, 3).map((r) => r.status)).toEqual([200, 200, 200]);
      expect(results[3].status).toBe(404); // someone else's offer looks like it doesn't exist

      const [b]: { driver_id: string }[] = await t.ds.query(
        'SELECT driver_id FROM bookings WHERE id = $1',
        [bookingId],
      );
      expect(b.driver_id).toBe(winner.driverId);
      const [{ count }]: { count: string }[] = await t.ds.query(
        "SELECT count(*) FROM booking_status_history WHERE booking_id = $1 AND to_status = 'driver_assigned'",
        [bookingId],
      );
      expect(Number(count)).toBe(1);
    });

    it('re-offers the job when the offered driver goes offline', async () => {
      const pickup = CITY.fujairah;
      const leaving = await onlineDriver(north(pickup, 1));
      const staying = await onlineDriver(north(pickup, 3));
      const { bookingId } = await book(pickup);
      const offer = await waitForOffer(leaving, bookingId);

      await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', leaving.token)
        .send({ status: 'offline' })
        .expect(200);
      await waitForOffer(staying, bookingId);
      await api()
        .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
        .set('Authorization', leaving.token)
        .expect(409);
    });

    it('keeps searching (BullMQ retries) until a driver becomes available', async () => {
      const pickup = CITY.ruwais;
      const { bookingId, customer } = await book(pickup);
      await waitFor(
        async () => (await getBooking(customer.token, bookingId)).status === 'searching',
      );
      await sleep(2_500); // a couple of empty search rounds
      const late = await onlineDriver(north(pickup, 2));
      await waitForOffer(late, bookingId, 8_000);
    });

    it('withdraws the offer when the customer cancels, and frees an assigned driver', async () => {
      const pickup = CITY.madinatZayed;
      const driver = await onlineDriver(north(pickup, 1));
      const socket = await connect(driver.token);
      const closed = new Promise<{ reason: string }>((r) => socket.once('offer:closed', r));

      const first = await book(pickup);
      const offer = await waitForOffer(driver, first.bookingId);
      await api()
        .post(`/api/v1/bookings/${first.bookingId}/cancel`)
        .set('Authorization', first.customer.token)
        .send({ reason: 'Vehicle started working' })
        .expect(200);
      expect((await closed).reason).toBe('cancelled');
      expect(await currentOffer(driver)).toBeNull();
      await api()
        .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
        .set('Authorization', driver.token)
        .expect(409);

      // Assigned, then cancelled: the driver is released and told.
      const jobCancelled = new Promise<{ bookingId: string }>((r) =>
        socket.once('job:cancelled', r),
      );
      const second = await book(pickup);
      const offer2 = await waitForOffer(driver, second.bookingId);
      await api()
        .post(`/api/v1/drivers/me/offers/${offer2.offerId}/accept`)
        .set('Authorization', driver.token)
        .expect(200);
      await api()
        .post(`/api/v1/bookings/${second.bookingId}/cancel`)
        .set('Authorization', second.customer.token)
        .send({ reason: 'Found another provider' })
        .expect(200);
      expect((await jobCancelled).bookingId).toBe(second.bookingId);
      const avail = await api()
        .get('/api/v1/drivers/me/availability')
        .set('Authorization', driver.token);
      expect(avail.body.availability).toBe('online');
    });
  });

  // ------------------------------------------------------------------ authorization

  describe('authorization', () => {
    it('keeps offers private to their driver and assignment out of customer hands', async () => {
      const pickup = CITY.ummAlQuwain;
      const driver = await onlineDriver(north(pickup, 1));
      const { bookingId, customer } = await book(pickup);
      const offer = await waitForOffer(driver, bookingId);

      // Customers can't use driver endpoints or see offers.
      await api()
        .get('/api/v1/drivers/me/offers/current')
        .set('Authorization', customer.token)
        .expect(403);
      await api()
        .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
        .set('Authorization', customer.token)
        .expect(403);
      // Customers can't pick their driver when booking.
      const res = await api()
        .post('/api/v1/bookings')
        .set('Authorization', customer.token)
        .send({
          quoteId: '00000000-0000-4000-8000-000000000000',
          issue: 'Other',
          paymentMethod: 'cash',
          driverId: driver.driverId,
        })
        .expect(400);
      expect(res.body.message).toContain('property driverId should not exist');
      // Drivers can't read customers' bookings.
      await api()
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', driver.token)
        .expect(403);
      // A driver can't move someone else's job.
      const stranger = await onlineDriver(CITY.hatta);
      await api()
        .post(`/api/v1/drivers/me/jobs/${bookingId}/en-route`)
        .set('Authorization', stranger.token)
        .expect(404);
    });
  });
});
