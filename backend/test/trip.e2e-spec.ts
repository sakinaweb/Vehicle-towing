import { rm } from 'node:fs/promises';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import {
  createTestApp,
  deleteUsersByPhone,
  signInAs,
  TestApp,
  uniquePhone,
} from './support/test-app.js';

/**
 * Phase 5: trip lifecycle, pickup/return inspections, the customer's live view
 * and admin KYC review — all against the real API, PostGIS, Redis, BullMQ and
 * Socket.IO. Each scenario is in its own town (> 15 km apart) so matching
 * never crosses scenarios. Photos go to the throwaway .e2e-storage folder.
 */
const TOWN = {
  madam: { lat: 24.97, lng: 55.79 },
  khorFakkan: { lat: 25.34, lng: 56.35 },
  dhaid: { lat: 25.28, lng: 55.88 },
  masafi: { lat: 25.3, lng: 56.16 },
  sweihan: { lat: 24.47, lng: 55.33 },
  mirfa: { lat: 24.1, lng: 53.45 },
  sila: { lat: 24.03, lng: 51.77 },
  ghantoot: { lat: 24.86, lng: 54.83 },
} as const;
type Point = { lat: number; lng: number };
const north = (p: Point, km: number): Point => ({ lat: p.lat + km / 111, lng: p.lng });

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  Buffer.from('JFIF test photo'),
]);
const PDF = Buffer.from('%PDF-1.4\n% test document\n');
const EXE = Buffer.from('MZ\x90\0this is not an image');
const CHECKLIST = {
  body: 'ok',
  glass: 'ok',
  lights: 'ok',
  tyres: 'damaged',
  mirrors: 'ok',
  interior: 'ok',
};

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

describe('Trip lifecycle, inspections, live tracking & KYC (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  const sockets: Socket[] = [];
  const api = () => request(t.baseUrl);

  interface DriverHandle {
    token: string;
    userId: string;
    driverId: string;
  }

  async function driverWithTruck(opts: { approved?: boolean } = {}): Promise<DriverHandle> {
    const d = await signInAs(t, 'driver', phones);
    const [{ id: driverId }]: { id: string }[] = await t.ds.query(
      'SELECT id FROM drivers WHERE user_id = $1',
      [d.userId],
    );
    if (opts.approved !== false) {
      await t.ds.query("UPDATE drivers SET kyc_status = 'approved' WHERE id = $1", [driverId]);
    }
    await api()
      .post('/api/v1/drivers/me/tow-trucks')
      .set('Authorization', d.token)
      .send({
        towType: 'flatbed',
        model: 'Isuzu NPR',
        year: 2023,
        plateEmirate: 'Sharjah',
        plateCode: '3',
        plateNumber: String(10_000 + Math.floor(Math.random() * 89_999)),
      })
      .expect(201);
    return { token: d.token, userId: d.userId, driverId };
  }

  async function goOnline(d: DriverHandle, at: Point) {
    await api()
      .put('/api/v1/drivers/me/availability')
      .set('Authorization', d.token)
      .send({ status: 'online' })
      .expect(200);
    await postLocation(d, at).expect(200);
  }

  const postLocation = (d: DriverHandle, at: Point & { recordedAt?: string }) =>
    api().post('/api/v1/drivers/me/location').set('Authorization', d.token).send(at);

  async function book(pickup: Point) {
    const c = await signInAs(t, 'customer', phones);
    const vehicle = await api()
      .post('/api/v1/customers/me/vehicles')
      .set('Authorization', c.token)
      .send({
        category: 'car',
        brand: 'Toyota',
        model: 'Land Cruiser',
        year: 2021,
        plateEmirate: 'Sharjah',
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
        pickup: { ...pickup, address: 'Pickup for trip test' },
        dropoff: { ...north(pickup, 6), address: 'Garage for trip test' },
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
      .body.offer as { offerId: string; bookingId: string } | null;

  /** An online driver at `town` who has accepted a fresh booking there. */
  async function acceptedJob(town: Point) {
    const driver = await driverWithTruck();
    await goOnline(driver, town);
    const { customer, bookingId } = await book(north(town, 1));
    const offer = await waitFor(async () => {
      const o = await currentOffer(driver);
      return o?.bookingId === bookingId ? o : null;
    });
    await api()
      .post(`/api/v1/drivers/me/offers/${offer.offerId}/accept`)
      .set('Authorization', driver.token)
      .expect(200);
    return { driver, customer, bookingId };
  }

  const step = (d: DriverHandle, bookingId: string, name: string) =>
    api().post(`/api/v1/drivers/me/jobs/${bookingId}/${name}`).set('Authorization', d.token);

  const saveInspection = (d: DriverHandle, bookingId: string, stage: string, body: object) =>
    api()
      .put(`/api/v1/drivers/me/jobs/${bookingId}/inspections/${stage}`)
      .set('Authorization', d.token)
      .send(body);

  const uploadPhoto = (
    d: DriverHandle,
    bookingId: string,
    stage: string,
    slot: string,
    file = JPEG,
  ) =>
    api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/inspections/${stage}/photos`)
      .set('Authorization', d.token)
      .field('slot', slot)
      .attach('file', file, { filename: `${slot}.jpg`, contentType: 'image/jpeg' });

  async function completeInspection(
    d: DriverHandle,
    bookingId: string,
    stage: string,
    odometerKm: number,
  ) {
    await saveInspection(d, bookingId, stage, {
      odometerKm,
      fuelLevel: 'half',
      checklist: CHECKLIST,
    }).expect(200);
    for (const slot of ['front', 'back', 'left', 'right']) {
      await uploadPhoto(d, bookingId, stage, slot).expect(201);
    }
    return api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/inspections/${stage}/submit`)
      .set('Authorization', d.token)
      .expect(200);
  }

  function connect(
    token: string,
  ): Promise<{ socket: Socket; events: { name: string; payload: any }[] }> {
    const socket = io(`${t.baseUrl}/realtime`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: token.replace('Bearer ', '') },
    });
    sockets.push(socket);
    const events: { name: string; payload: any }[] = [];
    socket.onAny((name: string, payload: unknown) => events.push({ name, payload }));
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve({ socket, events }));
      socket.on('connect_error', reject);
    });
  }

  const auditActions = async (entityId: string): Promise<string[]> => {
    const rows: { action: string }[] = await t.ds.query(
      'SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at',
      [entityId],
    );
    return rows.map((r) => r.action);
  };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
    await rm('./.e2e-storage', { recursive: true, force: true });
  });

  // ------------------------------------------------------------------ lifecycle

  describe('trip lifecycle', () => {
    it('runs accepted → en route → arrived → tow started → completed, live for the customer', async () => {
      const { driver, customer, bookingId } = await acceptedJob(TOWN.madam);
      const { events } = await connect(customer.token);

      const enRoute = await step(driver, bookingId, 'en-route').expect(200);
      expect(enRoute.body.status).toBe('driver_arriving');
      await step(driver, bookingId, 'en-route').expect(200); // idempotent
      const early = await step(driver, bookingId, 'start-tow').expect(409);
      expect(early.body.message).toBe(
        'Mark yourself arrived at the pickup before starting the tow.',
      );

      const arrived = await step(driver, bookingId, 'arrived').expect(200);
      expect(arrived.body).toMatchObject({
        status: 'driver_arrived',
        inspections: { pickup: 'none', return: 'none' },
      });
      const noInspection = await step(driver, bookingId, 'start-tow').expect(409);
      expect(noInspection.body.message).toBe('Submit the pickup inspection first.');
      // The truck is on scene: the customer can no longer cancel in the app.
      await api()
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', customer.token)
        .send({ reason: 'Changed my mind' })
        .expect(409);

      const pickup = await completeInspection(driver, bookingId, 'pickup', 45_120);
      expect(pickup.body).toMatchObject({ stage: 'pickup', odometerKm: 45_120, fuelLevel: 'half' });
      expect(pickup.body.submittedAt).toBeTruthy();
      expect(pickup.body.photos).toHaveLength(4);
      await api() // submitting again is harmless
        .post(`/api/v1/drivers/me/jobs/${bookingId}/inspections/pickup/submit`)
        .set('Authorization', driver.token)
        .expect(200);

      const towing = await step(driver, bookingId, 'start-tow').expect(200);
      expect(towing.body).toMatchObject({
        status: 'in_transit',
        inspections: { pickup: 'submitted' },
      });

      // Submitted pickup inspection is locked.
      const locked = await saveInspection(driver, bookingId, 'pickup', {
        odometerKm: 1,
        fuelLevel: 'full',
        checklist: CHECKLIST,
      }).expect(409);
      expect(locked.body.message).toMatch(/already submitted/);

      const lower = await saveInspection(driver, bookingId, 'return', {
        odometerKm: 45_100,
        fuelLevel: 'half',
        checklist: CHECKLIST,
      }).expect(400);
      expect(lower.body.message).toBe(
        'Return odometer (45100 km) cannot be lower than the pickup reading (45120 km).',
      );
      const noReturn = await step(driver, bookingId, 'complete').expect(409);
      expect(noReturn.body.message).toBe('Submit the return inspection first.');
      await completeInspection(driver, bookingId, 'return', 45_127);

      const done = await step(driver, bookingId, 'complete').expect(200);
      expect(done.body.status).toBe('completed');
      await step(driver, bookingId, 'complete').expect(200); // idempotent
      await step(driver, bookingId, 'arrived').expect(409);

      const booking = (
        await api()
          .get(`/api/v1/bookings/${bookingId}`)
          .set('Authorization', customer.token)
          .expect(200)
      ).body;
      expect(booking.status).toBe('completed');
      const [d]: { availability: string; total_trips: number }[] = await t.ds.query(
        'SELECT availability, total_trips FROM drivers WHERE id = $1',
        [driver.driverId],
      );
      expect(d).toEqual({ availability: 'online', total_trips: 1 });
      const job = await api()
        .get('/api/v1/drivers/me/jobs/current')
        .set('Authorization', driver.token)
        .expect(200);
      expect(job.body.job).toBeNull();

      await waitFor(() => Promise.resolve(events.some((e) => e.payload?.status === 'completed')));
      const statuses = events
        .filter((e) => e.name === 'booking:updated')
        .map((e) => e.payload.status);
      expect(statuses).toEqual(['driver_arriving', 'driver_arrived', 'in_transit', 'completed']);

      // The customer can review both inspections and their photos.
      const list = await api()
        .get(`/api/v1/bookings/${bookingId}/inspections`)
        .set('Authorization', customer.token)
        .expect(200);
      expect(list.body.inspections.map((i: { stage: string }) => i.stage)).toEqual([
        'pickup',
        'return',
      ]);
      const photoId = list.body.inspections[0].photos[0].id as string;
      const photo = await api()
        .get(`/api/v1/bookings/${bookingId}/inspections/photos/${photoId}`)
        .set('Authorization', customer.token)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(photo.headers['content-type']).toBe('image/jpeg');
      expect(photo.body).toEqual(JPEG);

      expect(await auditActions(bookingId)).toEqual(
        expect.arrayContaining([
          'trip.en_route',
          'trip.driver_arrived',
          'inspection.submitted',
          'trip.tow_started',
          'trip.completed',
        ]),
      );
    });

    it('only lets the assigned driver move the trip', async () => {
      const { driver, customer, bookingId } = await acceptedJob(TOWN.khorFakkan);
      const other = await driverWithTruck();
      await step(other, bookingId, 'en-route').expect(404);
      await saveInspection(other, bookingId, 'pickup', {
        odometerKm: 1,
        fuelLevel: 'full',
        checklist: CHECKLIST,
      }).expect(404);
      await api()
        .get(`/api/v1/drivers/me/jobs/${bookingId}/inspections`)
        .set('Authorization', other.token)
        .expect(404);
      // Customers cannot move trips at all.
      await step(customer as unknown as DriverHandle, bookingId, 'en-route').expect(403);
      await api().post(`/api/v1/drivers/me/jobs/${bookingId}/arrived`).expect(401);
      // Skipping a step is refused with the missing prerequisite.
      const skip = await step(driver, bookingId, 'arrived').expect(409);
      expect(skip.body.message).toBe(
        'Start driving to the pickup before marking yourself arrived.',
      );
      await step(driver, bookingId, 'not-a-step').expect(404);
    });

    it('refuses trip steps once the customer has cancelled', async () => {
      const { driver, customer, bookingId } = await acceptedJob(TOWN.mirfa);
      await step(driver, bookingId, 'en-route').expect(200);
      await api()
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', customer.token)
        .send({ reason: 'Fixed it myself' })
        .expect(200);
      const res = await step(driver, bookingId, 'arrived').expect(409);
      expect(res.body.message).toBe('This job was cancelled.');
    });
  });

  // ------------------------------------------------------------------ inspections

  describe('inspections', () => {
    it('validates data and photos, and enforces stage and limits', async () => {
      const { driver, customer, bookingId } = await acceptedJob(TOWN.dhaid);
      await step(driver, bookingId, 'en-route').expect(200);
      const tooEarly = await saveInspection(driver, bookingId, 'pickup', {
        odometerKm: 9,
        fuelLevel: 'full',
        checklist: CHECKLIST,
      }).expect(409);
      expect(tooEarly.body.message).toMatch(/after arriving/);
      await step(driver, bookingId, 'arrived').expect(200);

      const photoFirst = await uploadPhoto(driver, bookingId, 'pickup', 'front').expect(409);
      expect(photoFirst.body.message).toMatch(/Save the odometer/);
      const invalid = await saveInspection(driver, bookingId, 'pickup', {
        odometerKm: -1,
        fuelLevel: 'lots',
        checklist: { body: 'ok' },
        bookingOwnerId: 'x',
      }).expect(400);
      expect(invalid.body.message).toEqual(
        expect.arrayContaining([
          'odometerKm must not be less than 0',
          expect.stringMatching(/^fuelLevel must be one of/),
          expect.stringMatching(/^checklist\.glass must be one of/),
          'property bookingOwnerId should not exist',
        ]),
      );
      await saveInspection(driver, bookingId, 'pickup', {
        odometerKm: 9,
        fuelLevel: 'full',
        checklist: CHECKLIST,
      }).expect(200);
      const returnNow = await saveInspection(driver, bookingId, 'return', {
        odometerKm: 9,
        fuelLevel: 'full',
        checklist: CHECKLIST,
      }).expect(409);
      expect(returnNow.body.message).toMatch(/after starting the tow/);

      const notImage = await uploadPhoto(driver, bookingId, 'pickup', 'front', EXE).expect(400);
      expect(notImage.body.message).toBe('Photos must be JPEG, PNG, WebP or HEIC images.');
      await api()
        .post(`/api/v1/drivers/me/jobs/${bookingId}/inspections/pickup/photos`)
        .set('Authorization', driver.token)
        .field('slot', 'front')
        .expect(400);
      await uploadPhoto(driver, bookingId, 'pickup', 'roof').expect(400);
      await uploadPhoto(
        driver,
        bookingId,
        'pickup',
        'front',
        Buffer.concat([JPEG, Buffer.alloc(8 * 1024 * 1024)]),
      ).expect(413);

      await uploadPhoto(driver, bookingId, 'pickup', 'front').expect(201);
      const replaced = await uploadPhoto(driver, bookingId, 'pickup', 'front').expect(201); // retake replaces
      expect(replaced.body.photos.filter((p: { slot: string }) => p.slot === 'front')).toHaveLength(
        1,
      );
      await uploadPhoto(driver, bookingId, 'pickup', 'back').expect(201);
      const missing = await api()
        .post(`/api/v1/drivers/me/jobs/${bookingId}/inspections/pickup/submit`)
        .set('Authorization', driver.token)
        .expect(409);
      expect(missing.body.message).toBe('Add the left, right photos first.');

      let last = replaced;
      for (let i = 0; i < 6; i++)
        last = await uploadPhoto(driver, bookingId, 'pickup', 'extra').expect(201);
      const seventh = await uploadPhoto(driver, bookingId, 'pickup', 'extra').expect(409);
      expect(seventh.body.message).toBe('At most 6 extra photos per inspection.');
      const extra = last.body.photos.find((p: { slot: string }) => p.slot === 'extra');
      const afterDelete = await api()
        .delete(`/api/v1/drivers/me/jobs/${bookingId}/inspections/pickup/photos/${extra.id}`)
        .set('Authorization', driver.token)
        .expect(200);
      expect(
        afterDelete.body.photos.filter((p: { slot: string }) => p.slot === 'extra'),
      ).toHaveLength(5);

      // Stored keys are server-generated and never exposed.
      const [row]: { storage_key: string }[] = await t.ds.query(
        `SELECT p.storage_key FROM inspection_photos p JOIN booking_inspections i ON i.id = p.inspection_id
          WHERE i.booking_id = $1 LIMIT 1`,
        [bookingId],
      );
      expect(row.storage_key).toMatch(
        new RegExp(`^bookings/${bookingId}/inspections/pickup/[0-9a-f-]{36}\\.jpg$`),
      );
      expect(JSON.stringify(afterDelete.body)).not.toContain('storage');

      // Only the booking's customer (or driver/admin) can see them.
      const stranger = await signInAs(t, 'customer', phones);
      await api()
        .get(`/api/v1/bookings/${bookingId}/inspections`)
        .set('Authorization', stranger.token)
        .expect(404);
      await api()
        .get(`/api/v1/bookings/${bookingId}/inspections`)
        .set('Authorization', customer.token)
        .expect(200);
    });
  });

  // ------------------------------------------------------------------ live tracking

  describe('live tracking', () => {
    it("shows the customer their driver's live position with an honest ETA and staleness", async () => {
      const { driver, customer, bookingId } = await acceptedJob(TOWN.masafi);
      const view = await api()
        .get(`/api/v1/bookings/${bookingId}/driver-location`)
        .set('Authorization', customer.token)
        .expect(200);
      expect(view.body).toMatchObject({
        bookingId,
        status: 'driver_assigned',
        location: { lat: TOWN.masafi.lat, lng: TOWN.masafi.lng, stale: false },
        eta: { target: 'pickup', status: 'unavailable', reason: 'not_configured' },
      });
      expect(JSON.stringify(view.body)).not.toMatch(/phone|driverId|userId/);

      // Live position pushed only to this booking's customer.
      const mine = await connect(customer.token);
      const stranger = await signInAs(t, 'customer', phones);
      const theirs = await connect(stranger.token);
      await step(driver, bookingId, 'en-route').expect(200);
      const moved = north(TOWN.masafi, 0.5);
      await postLocation(driver, moved).expect(200);
      const pushed = await waitFor(() =>
        Promise.resolve(mine.events.find((e) => e.name === 'trip:location')),
      );
      expect(pushed.payload).toMatchObject({ bookingId, lat: moved.lat, lng: moved.lng });
      await sleep(300);
      expect(theirs.events.filter((e) => e.name === 'trip:location')).toEqual([]);

      // Older positions are refused; customers can never publish one.
      await postLocation(driver, {
        ...moved,
        recordedAt: new Date(Date.now() - 60_000).toISOString(),
      }).expect(409);
      await api()
        .post('/api/v1/drivers/me/location')
        .set('Authorization', customer.token)
        .send(moved)
        .expect(403);
      const ack = await mine.socket.timeout(3000).emitWithAck('driver:location', moved);
      expect(ack).toEqual({ ok: false, error: 'forbidden' });

      // Stale: Redis has expired it and the stored fix is old.
      await t.redis.del(`driver:location:${driver.driverId}`);
      await t.ds.query(
        "UPDATE drivers SET location_updated_at = now() - interval '10 minutes' WHERE id = $1",
        [driver.driverId],
      );
      const stale = await api()
        .get(`/api/v1/bookings/${bookingId}/driver-location`)
        .set('Authorization', customer.token)
        .expect(200);
      expect(stale.body.location.stale).toBe(true);
      expect(stale.body.location.ageSeconds).toBeGreaterThanOrEqual(590);
      expect(stale.body.eta).toEqual({
        target: 'pickup',
        status: 'unavailable',
        reason: 'location_unavailable',
      });

      // Someone else's booking looks like no booking (and the attempt is audited).
      await api()
        .get(`/api/v1/bookings/${bookingId}/driver-location`)
        .set('Authorization', stranger.token)
        .expect(404);
      expect(await auditActions(bookingId)).toContain('security.trip_location_denied');
      await api()
        .get(`/api/v1/bookings/${bookingId}/driver-location`)
        .set('Authorization', driver.token)
        .expect(403);
    });

    it('has no location to show before a driver is assigned', async () => {
      const { customer, bookingId } = await book(TOWN.sila);
      const res = await api()
        .get(`/api/v1/bookings/${bookingId}/driver-location`)
        .set('Authorization', customer.token)
        .expect(409);
      expect(res.body.message).toBe('No driver is on this booking right now.');
      await api()
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', customer.token)
        .send({ reason: 'test' });
    });
  });

  // ------------------------------------------------------------------ KYC

  describe('admin KYC', () => {
    it('signs in provisioned admins only', async () => {
      const admin = await signInAs(t, 'admin', phones);
      await api().get('/api/v1/admin/drivers').set('Authorization', admin.token).expect(200);
      const stranger = uniquePhone();
      phones.push(stranger);
      await api().post('/api/v1/auth/otp/request').send({ phone: stranger }).expect(202);
      const denied = await api()
        .post('/api/v1/auth/otp/verify')
        .send({ phone: stranger, code: t.sms.lastCode(stranger), role: 'admin' })
        .expect(403);
      expect(denied.body.message).toBe('This number is not registered as a TowNow admin.');
      const [exists]: { n: string }[] = await t.ds.query(
        'SELECT count(*) AS n FROM users WHERE phone = $1',
        [stranger],
      );
      expect(exists.n).toBe('0');
    });

    it('reviews documents, rejects with a reason, approves, and only approved drivers are matched', async () => {
      const admin = await signInAs(t, 'admin', phones);
      const driver = await driverWithTruck({ approved: false });
      const driverSocket = await connect(driver.token);

      // Non-admins never reach the console.
      await api().get('/api/v1/admin/drivers').set('Authorization', driver.token).expect(403);
      const someCustomer = await signInAs(t, 'customer', phones);
      await api().get('/api/v1/admin/drivers').set('Authorization', someCustomer.token).expect(403);
      await api().get('/api/v1/admin/drivers').expect(401);

      // Approval needs every document.
      const early = await api()
        .post(`/api/v1/admin/drivers/${driver.driverId}/kyc/approve`)
        .set('Authorization', admin.token)
        .expect(409);
      expect(early.body.message).toMatch(/^Missing documents: emirates_id/);

      const upload = (type: string, file: Buffer) =>
        api()
          .put(`/api/v1/drivers/me/documents/${type}`)
          .set('Authorization', driver.token)
          .field('documentNumber', 'DOC-123')
          .attach('file', file, { filename: `${type}.pdf`, contentType: 'application/pdf' });
      const bad = await upload('emirates_id', EXE).expect(400);
      expect(bad.body.message).toBe('Documents must be PDF, JPEG, PNG, WebP or HEIC files.');
      await upload('passport', PDF).expect(400);
      for (const type of [
        'emirates_id',
        'driving_licence',
        'vehicle_registration',
        'commercial_insurance',
      ]) {
        await upload(type, type === 'driving_licence' ? JPEG : PDF).expect(200);
      }

      const queue = await api()
        .get('/api/v1/admin/drivers?kycStatus=pending&limit=50')
        .set('Authorization', admin.token)
        .expect(200);
      const item = queue.body.items.find(
        (i: { driverId: string }) => i.driverId === driver.driverId,
      );
      expect(item).toMatchObject({
        kycStatus: 'pending',
        documentsUploaded: 4,
        documentsRequired: 4,
        towTrucks: 1,
      });

      const detail = await api()
        .get(`/api/v1/admin/drivers/${driver.driverId}`)
        .set('Authorization', admin.token)
        .expect(200);
      expect(detail.body.missingDocuments).toEqual([]);
      expect(detail.body.documents).toHaveLength(4);
      expect(JSON.stringify(detail.body)).not.toContain('fileKey');
      const doc = detail.body.documents.find((d: { type: string }) => d.type === 'emirates_id');
      const file = await api()
        .get(`/api/v1/admin/drivers/${driver.driverId}/documents/${doc.id}/file`)
        .set('Authorization', admin.token)
        .expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      await api()
        .get(`/api/v1/admin/drivers/${driver.driverId}/documents/${doc.id}/file`)
        .set('Authorization', driver.token)
        .expect(403);

      // A pending driver is never matched, even if marked online and nearby.
      await t.ds.query(
        `UPDATE drivers SET availability = 'online', location_updated_at = now(),
                current_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography WHERE id = $1`,
        [driver.driverId, TOWN.sweihan.lng, TOWN.sweihan.lat],
      );
      const { bookingId } = await book(north(TOWN.sweihan, 1));
      await sleep(1500);
      expect(await currentOffer(driver)).toBeNull();

      // Reject: reason required, driver taken offline and told why.
      await api()
        .post(`/api/v1/admin/drivers/${driver.driverId}/kyc/reject`)
        .set('Authorization', admin.token)
        .send({ reason: '' })
        .expect(400);
      const rejected = await api()
        .post(`/api/v1/admin/drivers/${driver.driverId}/kyc/reject`)
        .set('Authorization', admin.token)
        .send({ reason: 'Emirates ID scan is blurry' })
        .expect(200);
      expect(rejected.body).toMatchObject({
        kycStatus: 'rejected',
        kycRejectionReason: 'Emirates ID scan is blurry',
        availability: 'offline',
      });
      const profile = await api()
        .get('/api/v1/drivers/me')
        .set('Authorization', driver.token)
        .expect(200);
      expect(profile.body.kycRejectionReason).toBe('Emirates ID scan is blurry');
      const blocked = await api()
        .put('/api/v1/drivers/me/availability')
        .set('Authorization', driver.token)
        .send({ status: 'online' })
        .expect(409);
      expect(blocked.body.message).toMatch(/not approved: Emirates ID scan is blurry/);

      // Resubmitting puts the application back in review.
      await upload('emirates_id', PDF).expect(200);
      const back = await api()
        .get(`/api/v1/admin/drivers/${driver.driverId}`)
        .set('Authorization', admin.token);
      expect(back.body.kycStatus).toBe('pending');

      const approved = await api()
        .post(`/api/v1/admin/drivers/${driver.driverId}/kyc/approve`)
        .set('Authorization', admin.token)
        .expect(200);
      expect(approved.body).toMatchObject({ kycStatus: 'approved', kycRejectionReason: null });
      await api() // idempotent
        .post(`/api/v1/admin/drivers/${driver.driverId}/kyc/approve`)
        .set('Authorization', admin.token)
        .expect(200);
      await upload('emirates_id', PDF).expect(409); // documents locked after approval

      // Now approved: goes online and receives the waiting job.
      await goOnline(driver, TOWN.sweihan);
      const offer = await waitFor(async () => {
        const o = await currentOffer(driver);
        return o?.bookingId === bookingId ? o : null;
      });
      expect(offer.bookingId).toBe(bookingId);

      await waitFor(() =>
        Promise.resolve(
          driverSocket.events.filter((e) => e.name === 'kyc:updated').length >= 2 &&
            driverSocket.events.some((e) => e.payload?.kycStatus === 'approved'),
        ),
      );
      const actions = await auditActions(driver.driverId);
      expect(actions.filter((a) => a === 'kyc.approved')).toHaveLength(1);
      expect(actions).toEqual(
        expect.arrayContaining(['kyc.rejected', 'kyc.approved', 'kyc.document_uploaded']),
      );
      const [rejectAudit]: { actor_user_id: string; metadata: Record<string, unknown> }[] =
        await t.ds.query(
          "SELECT actor_user_id, metadata FROM audit_logs WHERE entity_id = $1 AND action = 'kyc.rejected'",
          [driver.driverId],
        );
      expect(rejectAudit).toEqual({
        actor_user_id: admin.userId,
        metadata: { previousStatus: 'pending', reason: 'Emirates ID scan is blurry' },
      });
    });

    it('cannot reject a driver in the middle of a job', async () => {
      const admin = await signInAs(t, 'admin', phones);
      const { driver } = await acceptedJob(TOWN.ghantoot);
      const res = await api()
        .post(`/api/v1/admin/drivers/${driver.driverId}/kyc/reject`)
        .set('Authorization', admin.token)
        .send({ reason: 'Licence expired' })
        .expect(409);
      expect(res.body.message).toBe('This driver is on a job. Reject after the job is finished.');
    });
  });
});
