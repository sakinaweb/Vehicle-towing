import request from 'supertest';
import { calculateFare, TariffInput } from '../src/modules/pricing/fare.calculator.js';
import { createTestApp, deleteUsersByPhone, signInAs, TestApp } from './support/test-app.js';

const DUBAI_MALL = { lat: 25.1972, lng: 55.2744, address: 'Sheikh Zayed Rd, near Dubai Mall exit' };
const AL_QUOZ = { lat: 25.1386, lng: 55.2266, address: 'Street 8, Al Quoz Industrial Area 3' };
const DOHA = { lat: 25.2854, lng: 51.531, address: 'Corniche, Doha, Qatar' };
const FLATBED: TariffInput = {
  baseFareFils: 15_000,
  perKmFils: 480,
  minimumFareFils: 15_000,
  towTypeSurchargeFils: 5_000,
  nightSurchargeFils: 3_500,
  vatRateBps: 500,
  currency: 'AED',
};

describe('Pricing & bookings (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  let customer: { token: string; userId: string };
  let other: { token: string };
  let driver: { token: string };
  let carId: string;
  let bikeId: string;
  let spareCarId: string;

  const api = () => request(t.baseUrl);
  const addVehicle = async (token: string, overrides: Record<string, unknown> = {}) => {
    const res = await api()
      .post('/api/v1/customers/me/vehicles')
      .set('Authorization', token)
      .send({
        category: 'car',
        brand: 'Porsche',
        model: '911 Carrera',
        year: 2023,
        plateEmirate: 'Dubai',
        plateCode: 'A',
        plateNumber: String(10_000 + Math.floor(Math.random() * 89_999)),
        ...overrides,
      })
      .expect(201);
    return res.body.id as string;
  };
  const quote = (token: string, body: Record<string, unknown>) =>
    api().post('/api/v1/bookings/quotes').set('Authorization', token).send(body);
  const book = (token: string, quoteId: string, extra: Record<string, unknown> = {}) =>
    api()
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .send({ quoteId, issue: 'Engine Issue', paymentMethod: 'cash', ...extra });

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signInAs(t, 'customer', phones);
    other = await signInAs(t, 'customer', phones);
    driver = await signInAs(t, 'driver', phones);
    carId = await addVehicle(customer.token);
    spareCarId = await addVehicle(customer.token);
    bikeId = await addVehicle(customer.token, {
      category: 'motorbike',
      brand: 'Ducati',
      model: 'Monster',
    });
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
  });

  describe('tariffs', () => {
    it('publishes the seeded tariffs without sign-in', async () => {
      const res = await api().get('/api/v1/pricing/tariffs').expect(200);
      expect(res.body).toEqual(
        expect.arrayContaining([
          { towType: 'flatbed', ...FLATBED },
          expect.objectContaining({
            towType: 'wheel-lift',
            baseFareFils: 12_000,
            towTypeSurchargeFils: 0,
          }),
          expect.objectContaining({ towType: 'bike-carrier', baseFareFils: 12_000 }),
        ]),
      );
    });
  });

  describe('quotes', () => {
    const valid = () => ({
      vehicleId: carId,
      towType: 'flatbed',
      pickup: DUBAI_MALL,
      dropoff: AL_QUOZ,
    });

    it('is only for customers', async () => {
      await api().post('/api/v1/bookings/quotes').send(valid()).expect(401);
      await quote(driver.token, valid()).expect(403);
    });

    it('prices the trip on the server from the PostGIS distance', async () => {
      const before = new Date();
      const res = await quote(customer.token, valid()).expect(200);

      // Independent check of the distance: geodesic metres from PostGIS × road factor 1.3.
      const [{ m }]: { m: number }[] = await t.ds.query(
        `SELECT ST_Distance(ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
                            ST_SetSRID(ST_MakePoint($3,$4),4326)::geography) AS m`,
        [DUBAI_MALL.lng, DUBAI_MALL.lat, AL_QUOZ.lng, AL_QUOZ.lat],
      );
      const expectedMeters = Math.round(Number(m) * 1.3);
      expect(res.body.distanceMeters).toBe(expectedMeters);
      expect(expectedMeters).toBeGreaterThan(9_000);
      expect(expectedMeters).toBeLessThan(12_000);

      const expected = calculateFare(FLATBED, expectedMeters, before);
      expect(res.body.fare).toEqual(expected);
      expect(res.body.fare.vatFils).toBe(Math.round(res.body.fare.subtotalFils * 0.05));
      expect(res.body.fare.totalFils).toBe(res.body.fare.subtotalFils + res.body.fare.vatFils);
      expect(Number.isInteger(res.body.fare.totalFils)).toBe(true);
      expect(res.body).toMatchObject({
        vehicleId: carId,
        towType: 'flatbed',
        distanceSource: 'postgis-geodesic',
        pickup: DUBAI_MALL,
        dropoff: AL_QUOZ,
      });
      expect(Date.parse(res.body.expiresAt) - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    });

    it('charges wheel-lift less than flatbed for the same trip', async () => {
      const flat = await quote(customer.token, valid()).expect(200);
      const wheel = await quote(customer.token, { ...valid(), towType: 'wheel-lift' }).expect(200);
      expect(flat.body.fare.totalFils - wheel.body.fare.totalFils).toBe(
        Math.round((3_000 + 5_000) * 1.05), // AED 30 lower base + AED 50 surcharge, both + VAT
      );
    });

    it('rejects locations outside the UAE', async () => {
      const res = await quote(customer.token, { ...valid(), dropoff: DOHA }).expect(400);
      expect(res.body.message).toBe('Drop-off location is outside the TowNow service area (UAE).');
      const swapped = { lat: DUBAI_MALL.lng, lng: DUBAI_MALL.lat, address: 'swapped' };
      await quote(customer.token, { ...valid(), pickup: swapped }).expect(400);
    });

    it('rejects pickup and drop-off at the same place', async () => {
      const res = await quote(customer.token, { ...valid(), dropoff: DUBAI_MALL }).expect(400);
      expect(res.body.message).toBe(
        'Pickup and drop-off are the same place. Check the drop-off pin.',
      );
    });

    it('validates coordinates, addresses and enums', async () => {
      const res = await quote(customer.token, {
        vehicleId: 'nope',
        towType: 'crane',
        pickup: { lat: 95, lng: 200, address: '' },
        dropoff: {},
      }).expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'vehicleId must be a UUID',
          expect.stringMatching(/^towType must be one of/),
          'pickup.lat must be a latitude string or number',
          'pickup.lng must be a longitude string or number',
          'pickup.address must be longer than or equal to 3 characters',
        ]),
      );
    });

    it('matches tow equipment to the vehicle', async () => {
      const carOnBike = await quote(customer.token, { ...valid(), towType: 'bike-carrier' }).expect(
        400,
      );
      expect(carOnBike.body.message).toBe(
        "A motorbike carrier can't carry a car. Choose another tow type.",
      );
      await quote(customer.token, {
        ...valid(),
        vehicleId: bikeId,
        towType: 'bike-carrier',
      }).expect(200);
      await quote(customer.token, { ...valid(), vehicleId: bikeId, towType: 'wheel-lift' }).expect(
        400,
      );
    });

    it("refuses to quote for another customer's vehicle", async () => {
      const res = await quote(other.token, valid()).expect(404);
      expect(res.body.message).toBe('Vehicle not found.');
    });
  });

  describe('booking', () => {
    let bookingId: string;
    let quoteBody: { quoteId: string; fare: Record<string, number> };

    it('books exactly the quoted price and snapshots it', async () => {
      const q = await quote(customer.token, {
        vehicleId: carId,
        towType: 'flatbed',
        pickup: DUBAI_MALL,
        dropoff: AL_QUOZ,
      }).expect(200);
      quoteBody = q.body;

      const res = await book(customer.token, q.body.quoteId, { notes: '  Basement B2  ' }).expect(
        201,
      );
      bookingId = res.body.id;
      expect(res.body).toMatchObject({
        status: 'requested',
        towType: 'flatbed',
        issue: 'Engine Issue',
        notes: 'Basement B2',
        paymentMethod: 'cash',
        canCancel: true,
        cancellationFeeMayApply: false,
        vehicle: { id: carId, brand: 'Porsche' },
        pickup: DUBAI_MALL,
        dropoff: AL_QUOZ,
        distanceMeters: q.body.distanceMeters,
      });
      expect(res.body.bookingNumber).toMatch(/^TN-\d{6,}$/);
      expect(res.body.fare).toEqual({
        baseFareFils: q.body.fare.baseFareFils,
        distanceChargeFils: q.body.fare.distanceChargeFils,
        towTypeChargeFils: q.body.fare.towTypeSurchargeFils,
        additionalChargesFils:
          q.body.fare.nightSurchargeFils + q.body.fare.minimumFareAdjustmentFils,
        subtotalFils: q.body.fare.subtotalFils,
        vatRateBps: 500,
        vatFils: q.body.fare.vatFils,
        totalFils: q.body.fare.totalFils,
        currency: 'AED',
      });
      expect(res.body.history).toEqual([
        expect.objectContaining({ fromStatus: null, toStatus: 'requested' }),
      ]);

      // Stored with PostGIS geography and the full pricing snapshot.
      const [row]: { lat: number; lng: number; snapshot: { tariff: TariffInput } }[] =
        await t.ds.query(
          `SELECT ST_Y(pickup_point::geometry) AS lat, ST_X(pickup_point::geometry) AS lng,
                  fare_snapshot AS snapshot FROM bookings WHERE id = $1`,
          [bookingId],
        );
      expect(row).toMatchObject({ lat: DUBAI_MALL.lat, lng: DUBAI_MALL.lng });
      expect(row.snapshot.tariff).toEqual(FLATBED);
    });

    it('is idempotent: re-submitting the same quote returns the same booking', async () => {
      const replay = await book(customer.token, quoteBody.quoteId).expect(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.id).toBe(bookingId);
      const [{ count }]: { count: string }[] = await t.ds.query(
        'SELECT count(*) FROM bookings WHERE quote_id = $1',
        [quoteBody.quoteId],
      );
      expect(Number(count)).toBe(1);
    });

    it('creates exactly one booking when the same quote is submitted concurrently', async () => {
      const q = await quote(customer.token, {
        vehicleId: spareCarId,
        towType: 'wheel-lift',
        pickup: DUBAI_MALL,
        dropoff: AL_QUOZ,
      }).expect(200);
      const results = await Promise.all([1, 2, 3].map(() => book(customer.token, q.body.quoteId)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    });

    it('allows only one active tow per vehicle', async () => {
      const q = await quote(customer.token, {
        vehicleId: carId,
        towType: 'wheel-lift',
        pickup: DUBAI_MALL,
        dropoff: AL_QUOZ,
      }).expect(200);
      const res = await book(customer.token, q.body.quoteId).expect(409);
      expect(res.body.message).toBe(
        'This vehicle already has an active tow request. Open it from My Orders.',
      );
    });

    it("rejects expired quotes and other customers' quotes", async () => {
      const q = await quote(customer.token, {
        vehicleId: bikeId,
        towType: 'bike-carrier',
        pickup: DUBAI_MALL,
        dropoff: AL_QUOZ,
      }).expect(200);
      const stolen = await book(other.token, q.body.quoteId).expect(410);
      expect(stolen.body.message).toBe('This price has expired. Please get a new quote.');

      await t.redis.del(`booking-quote:${q.body.quoteId}`); // simulate the 15-minute expiry
      await book(customer.token, q.body.quoteId).expect(410);
      await book(customer.token, '00000000-0000-4000-8000-000000000000').expect(410);
    });

    it('refuses card and Apple Pay while no payment gateway is configured', async () => {
      const q = await quote(customer.token, {
        vehicleId: bikeId,
        towType: 'bike-carrier',
        pickup: DUBAI_MALL,
        dropoff: AL_QUOZ,
      }).expect(200);
      for (const paymentMethod of ['card', 'apple_pay']) {
        const res = await book(customer.token, q.body.quoteId, { paymentMethod }).expect(400);
        expect(res.body.message).toBe(
          'Card and Apple Pay are not available yet. Please choose cash.',
        );
      }
    });

    it('advertises cash only while no payment gateway is configured', async () => {
      const res = await api().get('/api/v1/payments/methods').expect(200); // public
      expect(res.body).toEqual({ methods: ['cash'] });
    });

    it('validates the booking request', async () => {
      const res = await api()
        .post('/api/v1/bookings')
        .set('Authorization', customer.token)
        .send({
          quoteId: 'x',
          issue: 'Bored',
          paymentMethod: 'crypto',
          notes: 'n'.repeat(501),
          price: 1,
        })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'quoteId must be a UUID',
          expect.stringMatching(/^issue must be one of/),
          expect.stringMatching(/^paymentMethod must be one of/),
          'notes must be shorter than or equal to 500 characters',
          'property price should not exist', // the client can never set the price
        ]),
      );
    });

    it('keeps the fare snapshot when tariffs change later', async () => {
      await t.ds.query(
        "UPDATE pricing_rules SET base_fare_fils = base_fare_fils + 99900 WHERE tow_type = 'flatbed'",
      );
      try {
        const res = await api()
          .get(`/api/v1/bookings/${bookingId}`)
          .set('Authorization', customer.token)
          .expect(200);
        expect(res.body.fare.totalFils).toBe(quoteBody.fare.totalFils);
      } finally {
        await t.ds.query(
          "UPDATE pricing_rules SET base_fare_fils = base_fare_fils - 99900 WHERE tow_type = 'flatbed'",
        );
      }
    });

    it('lists my bookings with status filters and pagination', async () => {
      const all = await api()
        .get('/api/v1/bookings')
        .set('Authorization', customer.token)
        .expect(200);
      expect(all.body).toMatchObject({ total: 2, page: 1, limit: 20 });
      const active = await api()
        .get('/api/v1/bookings?status=active&limit=1')
        .set('Authorization', customer.token)
        .expect(200);
      expect(active.body).toMatchObject({ total: 2, limit: 1 });
      expect(active.body.items).toHaveLength(1);
      await api()
        .get('/api/v1/bookings?status=completed')
        .set('Authorization', customer.token)
        .expect(200)
        .expect((r) => expect(r.body.total).toBe(0));
      await api()
        .get('/api/v1/bookings?status=lost&limit=500')
        .set('Authorization', customer.token)
        .expect(400);
      await api().get('/api/v1/bookings').set('Authorization', other.token).expect(200, {
        items: [],
        total: 0,
        page: 1,
        limit: 20,
      });
    });

    it("hides other customers' bookings and blocks drivers", async () => {
      await api()
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', other.token)
        .expect(404);
      await api()
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Authorization', other.token)
        .send({ reason: 'Not mine' })
        .expect(404);
      await api()
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', driver.token)
        .expect(403);
    });

    it("won't remove a vehicle that has an active tow", async () => {
      const res = await api()
        .delete(`/api/v1/customers/me/vehicles/${carId}`)
        .set('Authorization', customer.token)
        .expect(409);
      expect(res.body.message).toBe(
        "You can't remove a vehicle while it has an active tow request.",
      );
    });
  });

  describe('cancellation', () => {
    it('requires a reason', async () => {
      const list = await api()
        .get('/api/v1/bookings')
        .set('Authorization', customer.token)
        .expect(200);
      const res = await api()
        .post(`/api/v1/bookings/${list.body.items[0].id}/cancel`)
        .set('Authorization', customer.token)
        .send({ reason: 'x' })
        .expect(400);
      expect(res.body.message).toContain('reason must be longer than or equal to 3 characters');
    });

    it('cancels a requested tow free of charge and records it', async () => {
      const list = await api()
        .get('/api/v1/bookings?status=active')
        .set('Authorization', customer.token)
        .expect(200);
      const target = list.body.items.find(
        (b: { vehicle: { id: string } }) => b.vehicle.id === carId,
      );
      const res = await api()
        .post(`/api/v1/bookings/${target.id}/cancel`)
        .set('Authorization', customer.token)
        .send({ reason: 'Booked by mistake' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        canCancel: false,
        cancelledBy: 'customer',
        cancellationReason: 'Booked by mistake',
      });
      // Matching moves the booking to "searching" in the background; the timeline starts
      // with the request and ends with the cancellation either way.
      const statuses = res.body.history.map((h: { toStatus: string }) => h.toStatus);
      expect(statuses[0]).toBe('requested');
      expect(statuses[statuses.length - 1]).toBe('cancelled');
      expect(statuses.filter((s: string) => s !== 'searching')).toEqual(['requested', 'cancelled']);

      const again = await api()
        .post(`/api/v1/bookings/${target.id}/cancel`)
        .set('Authorization', customer.token)
        .send({ reason: 'Booked by mistake' })
        .expect(409);
      expect(again.body.message).toBe('This booking is already cancelled.');
    });

    it('frees the vehicle for a new tow after cancelling', async () => {
      const q = await quote(customer.token, {
        vehicleId: carId,
        towType: 'flatbed',
        pickup: DUBAI_MALL,
        dropoff: AL_QUOZ,
      }).expect(200);
      await book(customer.token, q.body.quoteId).expect(201);
    });

    it('flags a possible fee once a driver is assigned, and refuses once on scene', async () => {
      const list = await api()
        .get('/api/v1/bookings?status=active')
        .set('Authorization', customer.token)
        .expect(200);
      const [a, b] = list.body.items as { id: string }[];

      // Lifecycle transitions come from the dispatch phase; set them directly here.
      await t.ds.query("UPDATE bookings SET status = 'driver_arriving' WHERE id = $1", [a.id]);
      const arriving = await api()
        .get(`/api/v1/bookings/${a.id}`)
        .set('Authorization', customer.token);
      expect(arriving.body).toMatchObject({ canCancel: true, cancellationFeeMayApply: true });
      await api()
        .post(`/api/v1/bookings/${a.id}/cancel`)
        .set('Authorization', customer.token)
        .send({ reason: 'Found another provider' })
        .expect(200);

      await t.ds.query("UPDATE bookings SET status = 'driver_arrived' WHERE id = $1", [b.id]);
      const late = await api()
        .post(`/api/v1/bookings/${b.id}/cancel`)
        .set('Authorization', customer.token)
        .send({ reason: 'Changed my mind' })
        .expect(409);
      expect(late.body.message).toMatch(/can no longer be cancelled in the app/);
    });
  });
});
