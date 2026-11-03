import { randomUUID } from 'node:crypto';
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
 * Booking chat, SOS and the admin insight views, against the real API, PostGIS, Redis,
 * BullMQ and Socket.IO. Towns are > 15 km from every other spec's so matching never crosses.
 */
const TOWN = {
  ruwais: { lat: 24.11, lng: 52.73 },
  hatta: { lat: 24.8, lng: 56.12 },
} as const;
type Point = { lat: number; lng: number };
const north = (p: Point, km: number): Point => ({ lat: p.lat + km / 111, lng: p.lng });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  ms = 10_000,
) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(150);
  }
}

describe('Chat, SOS and admin insights (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  const sockets: Socket[] = [];
  const api = () => request(t.baseUrl);
  type Handle = { token: string; userId: string };

  async function onlineDriver(at: Point): Promise<Handle> {
    const d = await signInAs(t, 'driver', phones);
    await t.ds.query("UPDATE drivers SET kyc_status = 'approved' WHERE user_id = $1", [d.userId]);
    await api()
      .post('/api/v1/drivers/me/tow-trucks')
      .set('Authorization', d.token)
      .send({
        towType: 'flatbed',
        model: 'Isuzu NPR',
        year: 2023,
        plateEmirate: 'Dubai',
        plateCode: 'K',
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
    return d;
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
        year: 2022,
        plateEmirate: 'Dubai',
        plateCode: 'B',
        plateNumber: String(10_000 + Math.floor(Math.random() * 89_999)),
      })
      .expect(201);
    const quote = await api()
      .post('/api/v1/bookings/quotes')
      .set('Authorization', c.token)
      .send({
        vehicleId: vehicle.body.id,
        towType: 'flatbed',
        pickup: { ...pickup, address: 'Chat test pickup' },
        dropoff: { ...north(pickup, 5), address: 'Chat test garage' },
      })
      .expect(200);
    const booking = await api()
      .post('/api/v1/bookings')
      .set('Authorization', c.token)
      .send({ quoteId: quote.body.quoteId, issue: 'Flat Tyre', paymentMethod: 'cash' })
      .expect(201);
    return { customer: c, bookingId: booking.body.id as string };
  }

  async function acceptedJob(town: Point) {
    const driver = await onlineDriver(town);
    const { customer, bookingId } = await book(north(town, 1));
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
    return { driver, customer, bookingId };
  }

  function connect(token: string) {
    const socket = io(`${t.baseUrl}/realtime`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: token.replace('Bearer ', '') },
    });
    sockets.push(socket);
    const events: { name: string; payload: any }[] = [];
    socket.onAny((name: string, payload: unknown) => events.push({ name, payload }));
    return new Promise<{ events: typeof events }>((resolve, reject) => {
      socket.on('connect', () => resolve({ events }));
      socket.on('connect_error', reject);
    });
  }

  const messages = (h: Handle, bookingId: string) =>
    api().get(`/api/v1/bookings/${bookingId}/messages`).set('Authorization', h.token);
  const say = (h: Handle, bookingId: string, body: string, clientId?: string) =>
    api()
      .post(`/api/v1/bookings/${bookingId}/messages`)
      .set('Authorization', h.token)
      .send({ body, clientId });

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
  });

  describe('chat', () => {
    it('customer and driver exchange messages live, with history, read receipts and pushes', async () => {
      const { driver, customer, bookingId } = await acceptedJob(TOWN.ruwais);
      const driverSocket = await connect(driver.token);
      const customerSocket = await connect(customer.token);

      const sent = await say(customer, bookingId, '  I am next to the blue gate  ').expect(201);
      expect(sent.body).toMatchObject({
        body: 'I am next to the blue gate', // trimmed
        senderRole: 'customer',
        mine: true,
        readAt: null,
      });

      // The driver gets it live; the customer's own other devices get the echo.
      const live = await waitFor(() => driverSocket.events.find((e) => e.name === 'chat:message'));
      expect(live.payload).toMatchObject({ id: sent.body.id, mine: false, senderRole: 'customer' });
      await waitFor(() => customerSocket.events.some((e) => e.name === 'chat:message'));

      // …and an inbox entry (→ push) for the recipient only.
      await waitFor(async () => {
        const rows: unknown[] = await t.ds.query(
          "SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'chat.message'",
          [driver.userId],
        );
        return rows.length > 0;
      });
      const senderPushes: unknown[] = await t.ds.query(
        "SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'chat.message'",
        [customer.userId],
      );
      expect(senderPushes).toHaveLength(0);

      await say(driver, bookingId, 'On my way, 10 minutes').expect(201);
      const history = await messages(customer, bookingId).expect(200);
      expect(history.body.map((m: { body: string; mine: boolean }) => [m.body, m.mine])).toEqual([
        ['I am next to the blue gate', true],
        ['On my way, 10 minutes', false],
      ]);

      // Driver reads → the customer's message gets readAt and the customer is told.
      await api()
        .post(`/api/v1/bookings/${bookingId}/messages/read`)
        .set('Authorization', driver.token)
        .expect(200);
      await waitFor(() => customerSocket.events.some((e) => e.name === 'chat:read'));
      const afterRead = await messages(customer, bookingId).expect(200);
      expect(afterRead.body[0].readAt).not.toBeNull();
      expect(afterRead.body[1].readAt).toBeNull(); // the driver's own message is not "read"
    });

    it('stores a retried send once (same client id)', async () => {
      const { customer, bookingId } = await acceptedJob(TOWN.hatta);
      const clientId = randomUUID();
      const first = await say(customer, bookingId, 'Hello?', clientId).expect(201);
      const retry = await say(customer, bookingId, 'Hello?', clientId).expect(201);
      expect(retry.body.id).toBe(first.body.id);
      expect((await messages(customer, bookingId).expect(200)).body).toHaveLength(1);
    });

    it('is private to the job: outsiders get 404, admins read but cannot write', async () => {
      const { bookingId: searching, customer } = await book(north(TOWN.ruwais, 40)); // no driver
      await say(customer, searching, 'anyone?').expect(409); // no driver on the job yet

      const outsider = await signInAs(t, 'customer', phones);
      await messages(outsider, searching).expect(404);
      await say(outsider, searching, 'hi').expect(404);

      const admin = await signInAs(t, 'admin', phones);
      await messages(admin, searching).expect(200);
      await say(admin, searching, 'ops here').expect(403);
      await say(customer, searching, '').expect(400);
    });
  });

  describe('SOS', () => {
    it('saves the alert, alerts admins live, and admins acknowledge then resolve it', async () => {
      const admin = await signInAs(t, 'admin', phones);
      const adminSocket = await connect(admin.token);
      const { customer, bookingId } = await book(north(TOWN.hatta, 30));
      const customerSocket = await connect(customer.token);

      const raised = await api()
        .post('/api/v1/sos')
        .set('Authorization', customer.token)
        .send({ bookingId, lat: 24.9, lng: 56.1, accuracyMeters: 12, note: 'Car on fire' })
        .expect(201);
      expect(raised.body).toMatchObject({
        status: 'open',
        raisedByRole: 'customer',
        bookingId,
        lat: 24.9,
        note: 'Car on fire',
      });
      expect(raised.body.bookingNumber).toMatch(/^TN-/);

      const alert = await waitFor(() => adminSocket.events.find((e) => e.name === 'sos:new'));
      expect(alert.payload.id).toBe(raised.body.id);
      await waitFor(async () => {
        const rows: unknown[] = await t.ds.query(
          "SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'sos.new'",
          [admin.userId],
        );
        return rows.length > 0;
      });

      const open = await api()
        .get('/api/v1/admin/sos')
        .set('Authorization', admin.token)
        .expect(200);
      expect(open.body.map((s: { id: string }) => s.id)).toContain(raised.body.id);

      const sosUrl = `/api/v1/admin/sos/${raised.body.id}`;
      await api().post(`${sosUrl}/acknowledge`).set('Authorization', admin.token).expect(200);
      await waitFor(() =>
        customerSocket.events.some(
          (e) => e.name === 'sos:updated' && e.payload.status === 'acknowledged',
        ),
      );
      await api().post(`${sosUrl}/acknowledge`).set('Authorization', admin.token).expect(409);
      const resolved = await api()
        .post(`${sosUrl}/resolve`)
        .set('Authorization', admin.token)
        .send({ resolution: 'Civil defence attended' })
        .expect(200);
      expect(resolved.body).toMatchObject({
        status: 'resolved',
        resolution: 'Civil defence attended',
      });
      await api().post(`${sosUrl}/resolve`).set('Authorization', admin.token).expect(409);

      const mine = await api()
        .get('/api/v1/me/sos')
        .set('Authorization', customer.token)
        .expect(200);
      expect(mine.body[0]).toMatchObject({ id: raised.body.id, status: 'resolved' });

      const audit = await api()
        .get('/api/v1/admin/audit-logs?action=sos')
        .set('Authorization', admin.token)
        .expect(200);
      const actions = audit.body.items
        .filter((a: { entityId: string }) => a.entityId === raised.body.id)
        .map((a: { action: string }) => a.action);
      expect(actions.sort()).toEqual(['sos.acknowledged', 'sos.raised', 'sos.resolved']);
    });

    it("works without a job or location, refuses other people's jobs, and is customer/driver only", async () => {
      const driver = await signInAs(t, 'driver', phones);
      await api().post('/api/v1/sos').set('Authorization', driver.token).send({}).expect(201);

      const { bookingId } = await book(north(TOWN.ruwais, 60));
      await api()
        .post('/api/v1/sos')
        .set('Authorization', driver.token)
        .send({ bookingId })
        .expect(404);

      const admin = await signInAs(t, 'admin', phones);
      await api().post('/api/v1/sos').set('Authorization', admin.token).send({}).expect(403);
      const stranger = await signInAs(t, 'customer', phones);
      await api().get('/api/v1/admin/sos').set('Authorization', stranger.token).expect(403);
    });
  });

  describe('admin insights', () => {
    it('shows online drivers on the map, payments with the money split, and the audit trail', async () => {
      const admin = await signInAs(t, 'admin', phones);
      const driver = await onlineDriver(north(TOWN.hatta, 60));
      const map = await api()
        .get('/api/v1/admin/driver-locations')
        .set('Authorization', admin.token)
        .expect(200);
      const me = map.body.find((d: { phone: string }) => d.phone === phones.at(-1));
      expect(me).toMatchObject({ availability: 'online', activeBookingNumber: null });
      expect(me.lat).toBeCloseTo(north(TOWN.hatta, 60).lat, 4);
      expect(driver.userId).toBeTruthy();

      const pay = await api()
        .get('/api/v1/admin/payments?limit=5')
        .set('Authorization', admin.token)
        .expect(200);
      expect(pay.body.totals).toEqual({
        count: expect.any(Number),
        collectedFils: expect.any(Number),
        vatFils: expect.any(Number),
        driverEarningsFils: expect.any(Number),
        commissionFils: expect.any(Number),
      });
      for (const p of pay.body.items) {
        if (p.commissionFils !== null) {
          expect(p.commissionFils + p.driverEarningFils).toBe(p.subtotalFils);
        }
      }

      // Date-range reports: a future range is empty; all-time covers today's; bad dates refused.
      const future = await api()
        .get('/api/v1/admin/payments?from=2099-01-01&to=2099-12-31')
        .set('Authorization', admin.token)
        .expect(200);
      expect(future.body.totals.count).toBe(0);
      const wide = await api()
        .get('/api/v1/admin/payments?from=2000-01-01&to=2099-12-31')
        .set('Authorization', admin.token)
        .expect(200);
      expect(wide.body.totals.count).toBe(pay.body.totals.count);
      await api()
        .get('/api/v1/admin/payments?from=01-01-2026')
        .set('Authorization', admin.token)
        .expect(400);

      const audit = await api()
        .get('/api/v1/admin/audit-logs?limit=3')
        .set('Authorization', admin.token)
        .expect(200);
      expect(audit.body.items.length).toBeGreaterThan(0);
      expect(audit.body.total).toBeGreaterThanOrEqual(audit.body.items.length);

      await api().get('/api/v1/admin/payments').set('Authorization', driver.token).expect(403);
      expect(uniquePhone()).toMatch(/^\+971/);
    });
  });
});
