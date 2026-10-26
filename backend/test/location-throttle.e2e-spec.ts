import request from 'supertest';
import type { TestApp } from './support/test-app.js';

// Config is validated when the app module is imported, so set the interval before importing it.
const previousInterval = process.env.DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS;
process.env.DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS = '30';
const { createTestApp, deleteUsersByPhone, signInAs } = await import('./support/test-app.js');

/** Redis gets every fix; PostgreSQL at most once per DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS. */
describe('Driver location write throttling (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
    process.env.DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS = previousInterval;
  });

  it('keeps Redis current while PostGIS is written at most every 30 s', async () => {
    const d = await signInAs(t, 'driver', phones);
    const [{ id: driverId }]: { id: string }[] = await t.ds.query(
      'SELECT id FROM drivers WHERE user_id = $1',
      [d.userId],
    );
    await t.ds.query("UPDATE drivers SET kyc_status = 'approved' WHERE id = $1", [driverId]);
    const api = () => request(t.baseUrl);
    await api()
      .post('/api/v1/drivers/me/tow-trucks')
      .set('Authorization', d.token)
      .send({
        towType: 'wheel-lift',
        model: 'Hino 300',
        year: 2022,
        plateEmirate: 'Ajman',
        plateCode: 'B',
        plateNumber: '48213',
      })
      .expect(201);
    await api()
      .put('/api/v1/drivers/me/availability')
      .set('Authorization', d.token)
      .send({ status: 'online' })
      .expect(200);

    const first = { lat: 23.9, lng: 52.6, recordedAt: new Date(Date.now() - 5_000).toISOString() };
    const second = { lat: 23.91, lng: 52.61, recordedAt: new Date().toISOString() };
    await api()
      .post('/api/v1/drivers/me/location')
      .set('Authorization', d.token)
      .send(first)
      .expect(200);
    await api()
      .post('/api/v1/drivers/me/location')
      .set('Authorization', d.token)
      .send(second)
      .expect(200);

    const [db]: { lat: number; recorded: Date }[] = await t.ds.query(
      'SELECT ST_Y(current_location::geometry) AS lat, location_updated_at AS recorded FROM drivers WHERE id = $1',
      [driverId],
    );
    expect(db.lat).toBeCloseTo(first.lat, 6); // second fix was within 30 s: not written
    expect(new Date(db.recorded).toISOString()).toBe(first.recordedAt);
    const cached = JSON.parse((await t.redis.get(`driver:location:${driverId}`))!) as {
      lat: number;
    };
    expect(cached.lat).toBe(second.lat); // Redis always has the newest
  });
});
