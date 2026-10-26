import request from 'supertest';
import { signStripePayload } from '../src/modules/payments/payment.rules.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { FakeStripe } from './support/fake-stripe.js';
import type { TestApp } from './support/test-app.js';

/**
 * Phase 6 against a local fake Stripe (no network, no real money): authorise at
 * booking, dispatch only once funds are held, signed + de-duplicated webhooks,
 * capture on completion, release on cancellation, refunds, cash, invoices, ledger.
 */
const stripe = new FakeStripe();
const WEBHOOK_SECRET = 'whsec_e2e_test_secret';
const ENV = {
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_e2e_fake',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_e2e_fake',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_API_BASE: await stripe.start(),
};
const previousEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
Object.assign(process.env, ENV); // config is validated when the app module is imported
const { createTestApp, deleteUsersByPhone, signInAs } = await import('./support/test-app.js');

const TOWN = {
  alHayer: { lat: 24.58, lng: 55.76 },
  ghayathi: { lat: 23.84, lng: 52.81 },
  khazna: { lat: 24.17, lng: 55.1 },
  wathba: { lat: 24.26, lng: 54.6 },
  faqa: { lat: 24.71, lng: 55.62 },
} as const;
type Point = { lat: number; lng: number };
const north = (p: Point, km: number): Point => ({ lat: p.lat + km / 111, lng: p.lng });
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  Buffer.from('JFIF photo'),
]);
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

describe('Payments, invoices & driver ledger (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  const api = () => request(t.baseUrl);
  let eventSeq = 0;
  const RUN = `evt_e2e_${Date.now()}`; // event ids are unique per run (dedup is permanent)

  interface DriverHandle {
    token: string;
    userId: string;
    driverId: string;
  }

  async function onlineDriver(at: Point): Promise<DriverHandle> {
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
        plateCode: '5',
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
    return { token: d.token, userId: d.userId, driverId };
  }

  async function book(pickup: Point, paymentMethod: 'card' | 'cash' | 'apple_pay') {
    const c = await signInAs(t, 'customer', phones);
    const vehicle = await api()
      .post('/api/v1/customers/me/vehicles')
      .set('Authorization', c.token)
      .send({
        category: 'car',
        brand: 'Lexus',
        model: 'LX',
        year: 2022,
        plateEmirate: 'Abu Dhabi',
        plateCode: '1',
        plateNumber: String(10_000 + Math.floor(Math.random() * 89_999)),
      })
      .expect(201);
    const quote = await api()
      .post('/api/v1/bookings/quotes')
      .set('Authorization', c.token)
      .send({
        vehicleId: vehicle.body.id,
        towType: 'flatbed',
        pickup: { ...pickup, address: 'Pickup for payment test' },
        dropoff: { ...north(pickup, 6), address: 'Garage for payment test' },
      })
      .expect(200);
    const booking = await api()
      .post('/api/v1/bookings')
      .set('Authorization', c.token)
      .send({ quoteId: quote.body.quoteId, issue: 'Breakdown', paymentMethod })
      .expect(201);
    return { customer: c, bookingId: booking.body.id as string, booking: booking.body };
  }

  const getBooking = async (token: string, id: string) =>
    (await api().get(`/api/v1/bookings/${id}`).set('Authorization', token).expect(200)).body;
  const paymentRow = async (bookingId: string) => {
    const rows: Record<string, any>[] = await t.ds.query(
      'SELECT * FROM payments WHERE booking_id = $1',
      [bookingId],
    );
    return rows[0];
  };
  const currentOffer = async (d: DriverHandle) =>
    (await api().get('/api/v1/drivers/me/offers/current').set('Authorization', d.token).expect(200))
      .body.offer as {
      offerId: string;
      bookingId: string;
    } | null;

  function webhook(
    type: string,
    object: unknown,
    opts: { id?: string; secret?: string; timestamp?: number } = {},
  ) {
    const body = JSON.stringify({ id: opts.id ?? `${RUN}_${++eventSeq}`, type, data: { object } });
    const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
    return api()
      .post('/api/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signStripePayload(body, opts.secret ?? WEBHOOK_SECRET, ts))
      .send(body);
  }

  async function acceptAndComplete(
    driver: DriverHandle,
    bookingId: string,
    beforeComplete: () => Promise<unknown> = () => Promise.resolve(),
  ) {
    const offer = await waitFor(async () => {
      const o = await currentOffer(driver);
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
    await inspect('pickup', 1000);
    await step('start-tow');
    await inspect('return', 1006);
    await beforeComplete();
    return step('complete');
  }

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.ds.query('DELETE FROM payment_webhook_events WHERE event_id LIKE $1', [`${RUN}%`]);
    await t.close();
    await stripe.stop();
    for (const [k, v] of Object.entries(previousEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('advertises card and Apple Pay once Stripe is configured', async () => {
    const res = await api().get('/api/v1/payments/methods').expect(200);
    expect(res.body).toEqual({ methods: ['cash', 'card', 'apple_pay'] });
  });

  // ------------------------------------------------------------------ authorisation

  it('holds dispatch until the card is authorised; handles a decline, a retry and duplicate webhooks', async () => {
    const driver = await onlineDriver(TOWN.alHayer);
    const { customer, bookingId, booking } = await book(north(TOWN.alHayer, 1), 'card');
    expect(booking.payment).toMatchObject({
      method: 'card',
      status: 'pending',
      amountFils: booking.fare.totalFils,
    });

    const pay = await api()
      .post(`/api/v1/bookings/${bookingId}/payment`)
      .set('Authorization', customer.token)
      .expect(200);
    expect(pay.body).toMatchObject({
      status: 'pending',
      provider: 'stripe',
      publishableKey: 'pk_test_e2e_fake',
      amountFils: booking.fare.totalFils,
    });
    expect(pay.body.clientSecret).toMatch(/^pi_test_\d+_secret_test$/);
    await api()
      .post(`/api/v1/bookings/${bookingId}/payment`)
      .set('Authorization', customer.token)
      .expect(200);
    const intentId = (await paymentRow(bookingId)).provider_reference as string;
    expect(
      stripe.callsTo('POST', '/v1/payment_intents').filter((c) => c.path === '/v1/payment_intents'),
    ).toHaveLength(1);
    expect(stripe.intents.get(intentId)).toMatchObject({
      capture_method: 'manual',
      currency: 'aed',
    });

    // Unpaid: never offered to the online driver nearby.
    await sleep(1500);
    expect(await currentOffer(driver)).toBeNull();

    // Declined card.
    const declined = await webhook(
      'payment_intent.payment_failed',
      stripe.decline(intentId),
    ).expect(200);
    expect(declined.body).toEqual({ received: true, duplicate: false });
    expect((await getBooking(customer.token, bookingId)).payment).toMatchObject({
      status: 'failed',
      failureReason: 'Your card was declined.',
    });

    // Retry approved → authorised → dispatch starts.
    const evt = { id: `${RUN}_authorised_once` };
    await webhook(
      'payment_intent.amount_capturable_updated',
      stripe.authorize(intentId),
      evt,
    ).expect(200);
    const dup = await webhook(
      'payment_intent.amount_capturable_updated',
      stripe.intents.get(intentId),
      evt,
    ).expect(200);
    expect(dup.body).toEqual({ received: true, duplicate: true });
    const paid = await getBooking(customer.token, bookingId);
    expect(paid.payment.status).toBe('authorized');
    expect(paid.payment.authorizedAt).toBeTruthy();
    const offer = await waitFor(async () => {
      const o = await currentOffer(driver);
      return o?.bookingId === bookingId ? o : null;
    });
    expect(offer.bookingId).toBe(bookingId);
    const [{ n }]: { n: string }[] = await t.ds.query(
      'SELECT count(*) AS n FROM payment_webhook_events WHERE event_id = $1',
      [`${RUN}_authorised_once`],
    );
    expect(n).toBe('1');

    // Once authorised, the client secret is no longer handed out.
    const after = await api()
      .post(`/api/v1/bookings/${bookingId}/payment`)
      .set('Authorization', customer.token)
      .expect(200);
    expect(after.body).toMatchObject({ status: 'authorized', clientSecret: null });
    await api()
      .post(`/api/v1/drivers/me/offers/${offer.offerId}/decline`)
      .set('Authorization', driver.token);
    await api()
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', customer.token)
      .send({ reason: 'test cleanup' });
  });

  it('rejects unsigned, forged and replayed webhooks, and amounts that do not match', async () => {
    const { customer, bookingId } = await book(TOWN.ghayathi, 'card');
    const intentId = (await paymentRow(bookingId)).provider_reference as string;
    const intent = stripe.authorize(intentId);

    await api()
      .post('/api/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({
        id: 'evt_x',
        type: 'payment_intent.amount_capturable_updated',
        data: { object: intent },
      })
      .expect(400);
    await webhook('payment_intent.amount_capturable_updated', intent, {
      secret: 'whsec_attacker',
    }).expect(400);
    await webhook('payment_intent.amount_capturable_updated', intent, {
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    }).expect(400);
    // Correct signature but a different amount than the booking: ignored and audited.
    await webhook('payment_intent.amount_capturable_updated', { ...intent, amount: 1 }).expect(200);
    expect((await paymentRow(bookingId)).status).toBe('pending');
    const audits: { action: string }[] = await t.ds.query(
      "SELECT action FROM audit_logs WHERE action IN ('security.webhook_rejected', 'security.payment_amount_mismatch') AND created_at > now() - interval '1 minute'",
    );
    expect(
      audits.filter((a) => a.action === 'security.webhook_rejected').length,
    ).toBeGreaterThanOrEqual(3);
    expect(audits.map((a) => a.action)).toContain('security.payment_amount_mismatch');

    // No webhook reached us? The app can ask the gateway directly.
    const synced = await api()
      .post(`/api/v1/bookings/${bookingId}/payment/sync`)
      .set('Authorization', customer.token)
      .expect(200);
    expect(synced.body.status).toBe('authorized');

    // Only the booking's customer can see or pay it.
    const stranger = await signInAs(t, 'customer', phones);
    await api()
      .post(`/api/v1/bookings/${bookingId}/payment`)
      .set('Authorization', stranger.token)
      .expect(404);
    await api()
      .post(`/api/v1/bookings/${bookingId}/payment/sync`)
      .set('Authorization', stranger.token)
      .expect(404);

    // Cancelling releases the hold — no charge, no fee.
    await api()
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', customer.token)
      .send({ reason: 'No longer needed' })
      .expect(200);
    await waitFor(async () => (await paymentRow(bookingId)).status === 'cancelled');
    expect(stripe.intents.get(intentId)!.status).toBe('canceled');
    expect(stripe.callsTo('POST', '/capture')).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ path: `/v1/payment_intents/${intentId}/capture` }),
      ]),
    );
  });

  it('cancels a card booking that is never paid for', async () => {
    const { customer, bookingId } = await book(TOWN.faqa, 'apple_pay');
    await t.app.get(PaymentsService).authTimeout(bookingId); // the delayed BullMQ job, run now
    const b = await getBooking(customer.token, bookingId);
    expect(b).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'system',
      cancellationReason: 'Payment was not completed in time',
    });
    expect(b.payment.status).toBe('cancelled');
  });

  // ------------------------------------------------------------------ completion

  it('captures once on completion, issues the invoice, credits the driver and supports a full refund', async () => {
    const driver = await onlineDriver(TOWN.khazna);
    const { customer, bookingId, booking } = await book(north(TOWN.khazna, 1), 'card');
    const intentId = (await paymentRow(bookingId)).provider_reference as string;
    await webhook('payment_intent.amount_capturable_updated', stripe.authorize(intentId)).expect(
      200,
    );

    await acceptAndComplete(driver, bookingId);
    await waitFor(async () => (await paymentRow(bookingId)).status === 'captured');
    expect(stripe.callsTo('POST', `/v1/payment_intents/${intentId}/capture`)).toHaveLength(1);
    // A late, out-of-order "authorised" event can't move it back.
    await webhook('payment_intent.amount_capturable_updated', {
      ...stripe.intents.get(intentId),
      status: 'requires_capture',
    }).expect(200);
    expect((await paymentRow(bookingId)).status).toBe('captured');

    const { subtotalFils, vatFils, totalFils } = booking.fare;
    const invoice = await api()
      .get(`/api/v1/bookings/${bookingId}/invoice`)
      .set('Authorization', customer.token)
      .expect(200);
    expect(invoice.body).toMatchObject({
      isTaxInvoice: false,
      title: 'Receipt',
      notice: expect.stringContaining('TRN'),
      bookingNumber: booking.bookingNumber,
      seller: { name: 'TowNow', trn: null },
      subtotalFils,
      vatRateBps: 500,
      vatFils,
      totalFils,
      paymentMethod: 'card',
      paymentStatus: 'captured',
    });
    expect(invoice.body.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(vatFils).toBe(Math.round(subtotalFils * 0.05));
    expect(subtotalFils + vatFils).toBe(totalFils);
    await api()
      .get(`/api/v1/bookings/${bookingId}/invoice`)
      .set('Authorization', driver.token)
      .expect(200);
    const stranger = await signInAs(t, 'customer', phones);
    await api()
      .get(`/api/v1/bookings/${bookingId}/invoice`)
      .set('Authorization', stranger.token)
      .expect(404);

    // Ledger: 80% of the fare excl. VAT, posted exactly once.
    const earnings = await api()
      .get('/api/v1/drivers/me/earnings')
      .set('Authorization', driver.token)
      .expect(200);
    const commission = Math.round(subtotalFils * 0.2);
    expect(earnings.body.balanceFils).toBe(subtotalFils - commission);
    expect(earnings.body.entries).toEqual([
      expect.objectContaining({
        type: 'trip_earning',
        amountFils: subtotalFils - commission,
        details: expect.objectContaining({
          commissionBps: 2000,
          commissionFils: commission,
          fareExclVatFils: subtotalFils,
        }),
      }),
    ]);
    await api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
      .set('Authorization', driver.token)
      .send({ amountFils: totalFils })
      .expect(409);

    // Refund: admin only, full, idempotent.
    const paymentId = (await paymentRow(bookingId)).id as string;
    await api()
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set('Authorization', customer.token)
      .send({ reason: 'Customer complaint' })
      .expect(403);
    const admin = await signInAs(t, 'admin', phones);
    await api()
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set('Authorization', admin.token)
      .send({ reason: 'x' })
      .expect(400);
    const refunded = await api()
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set('Authorization', admin.token)
      .send({ reason: 'Damaged bumper settlement' })
      .expect(200);
    expect(refunded.body).toMatchObject({ status: 'refunded' });
    await api()
      .post(`/api/v1/admin/payments/${paymentId}/refund`)
      .set('Authorization', admin.token)
      .send({ reason: 'Damaged bumper settlement' })
      .expect(200);
    await webhook('charge.refunded', {
      id: 'ch_1',
      refunded: true,
      payment_intent: intentId,
    }).expect(200);
    expect(stripe.refunds).toBe(1);
    const ledger = await api()
      .get(`/api/v1/admin/drivers/${driver.driverId}/ledger`)
      .set('Authorization', admin.token)
      .expect(200);
    expect(ledger.body.balanceFils).toBe(subtotalFils - commission);
  });

  it('records cash separately: full amount, after completion, once; the driver owes commission + VAT', async () => {
    const driver = await onlineDriver(TOWN.wathba);
    const { customer, bookingId, booking } = await book(north(TOWN.wathba, 1), 'cash');
    expect(booking.payment).toBeNull();
    const { subtotalFils, totalFils } = booking.fare;

    const offer = await waitFor(async () => {
      const o = await currentOffer(driver);
      return o?.bookingId === bookingId ? o : null;
    });
    expect(offer).toBeTruthy();
    // Not yet assigned: not their job.
    await api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
      .set('Authorization', driver.token)
      .send({ amountFils: totalFils })
      .expect(404);

    await acceptAndComplete(driver, bookingId, async () => {
      const early = await api()
        .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
        .set('Authorization', driver.token)
        .send({ amountFils: totalFils })
        .expect(409);
      expect(early.body.message).toBe('Complete the tow before confirming the cash payment.');
    });
    const short = await api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
      .set('Authorization', driver.token)
      .send({ amountFils: totalFils - 100 })
      .expect(400);
    expect(short.body.message).toMatch(/^Collect the full fare of AED/);
    const other = await onlineDriver(TOWN.ghayathi);
    await api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
      .set('Authorization', other.token)
      .send({ amountFils: totalFils })
      .expect(404);
    await api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
      .set('Authorization', customer.token)
      .send({ amountFils: totalFils })
      .expect(403);

    const cash = await api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
      .set('Authorization', driver.token)
      .send({ amountFils: totalFils })
      .expect(200);
    expect(cash.body).toMatchObject({ method: 'cash', status: 'captured', amountFils: totalFils });
    await api()
      .post(`/api/v1/drivers/me/jobs/${bookingId}/cash-collected`)
      .set('Authorization', driver.token)
      .send({ amountFils: totalFils })
      .expect(200);
    const row = await paymentRow(bookingId);
    expect(row).toMatchObject({
      provider: null,
      provider_reference: null,
      collected_by_id: driver.userId,
    });

    const earnings = await api()
      .get('/api/v1/drivers/me/earnings')
      .set('Authorization', driver.token)
      .expect(200);
    const commission = Math.round(subtotalFils * 0.2);
    // Earned (fare − 20%) minus the cash kept (fare + VAT) = − (commission + VAT) owed to TowNow.
    expect(earnings.body.balanceFils).toBe(subtotalFils - commission - totalFils);
    expect(earnings.body.entries.map((e: { type: string }) => e.type).sort()).toEqual([
      'cash_collected',
      'trip_earning',
    ]);

    const invoice = await api()
      .get(`/api/v1/bookings/${bookingId}/invoice`)
      .set('Authorization', customer.token)
      .expect(200);
    expect(invoice.body).toMatchObject({
      paymentMethod: 'cash',
      paymentStatus: 'captured',
      totalFils,
    });
    expect((await getBooking(customer.token, bookingId)).payment).toMatchObject({
      method: 'cash',
      status: 'captured',
    });
  });
});
