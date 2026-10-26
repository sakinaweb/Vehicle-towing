import request from 'supertest';
import { createTestApp, deleteUsersByPhone, signInAs, TestApp } from './support/test-app.js';

const VEHICLES = '/api/v1/customers/me/vehicles';
const plateNo = () => String(10_000 + Math.floor(Math.random() * 89_999));

describe('Customer vehicles (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  let owner: { token: string };
  let stranger: { token: string };
  let driver: { token: string };

  const car = () => ({
    category: 'car',
    brand: 'Toyota',
    model: 'Land Cruiser',
    year: 2022,
    color: 'Pearl White',
    plateEmirate: 'Dubai',
    plateCode: ' a ',
    plateNumber: plateNo(),
  });

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signInAs(t, 'customer', phones);
    stranger = await signInAs(t, 'customer', phones);
    driver = await signInAs(t, 'driver', phones);
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
  });

  const api = () => request(t.baseUrl);

  it('requires a signed-in customer', async () => {
    await api().get(VEHICLES).expect(401);
    await api().get(VEHICLES).set('Authorization', driver.token).expect(403);
    await api().post(VEHICLES).set('Authorization', driver.token).send(car()).expect(403);
  });

  it('starts empty, then registers a car as the default (plate normalised)', async () => {
    await api().get(VEHICLES).set('Authorization', owner.token).expect(200, []);
    const body = car();
    const res = await api().post(VEHICLES).set('Authorization', owner.token).send(body).expect(201);
    expect(res.body).toMatchObject({
      ...body,
      plateCode: 'A',
      isDefault: true, // first vehicle
    });
  });

  it('supports motorbikes and keeps a single default', async () => {
    const bike = await api()
      .post(VEHICLES)
      .set('Authorization', owner.token)
      .send({
        ...car(),
        category: 'motorbike',
        brand: 'Ducati',
        model: 'Panigale V4',
        isDefault: true,
      })
      .expect(201);
    expect(bike.body).toMatchObject({ category: 'motorbike', isDefault: true });

    const list = await api().get(VEHICLES).set('Authorization', owner.token).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((v: { isDefault: boolean }) => v.isDefault)).toHaveLength(1);
    expect(list.body[0].id).toBe(bike.body.id); // default listed first
  });

  it('validates every field', async () => {
    const res = await api()
      .post(VEHICLES)
      .set('Authorization', owner.token)
      .send({
        category: 'truck',
        brand: '',
        model: 'x'.repeat(81),
        year: 1900,
        plateEmirate: 'Narnia',
        plateCode: 'ABCD',
        plateNumber: '12a',
      })
      .expect(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^category must be one of/),
        'brand must be longer than or equal to 1 characters',
        'model must be shorter than or equal to 80 characters',
        'year must not be less than 1950',
        expect.stringMatching(/^plateEmirate must be one of/),
        'plateCode must be 1–3 letters or digits',
        'plateNumber must be 1–5 digits',
      ]),
    );
  });

  it('refuses a duplicate plate for the same customer, but allows it for another', async () => {
    const body = car();
    await api().post(VEHICLES).set('Authorization', owner.token).send(body).expect(201);
    const dup = await api().post(VEHICLES).set('Authorization', owner.token).send(body).expect(409);
    expect(dup.body.message).toBe('You have already registered a vehicle with this plate.');
    // Plates change hands (sold cars), so ownership is per customer account.
    await api().post(VEHICLES).set('Authorization', stranger.token).send(body).expect(201);
  });

  it('edits a vehicle and switches the default', async () => {
    const list = await api().get(VEHICLES).set('Authorization', owner.token).expect(200);
    const nonDefault = list.body.find((v: { isDefault: boolean }) => !v.isDefault);
    const res = await api()
      .patch(`${VEHICLES}/${nonDefault.id}`)
      .set('Authorization', owner.token)
      .send({ color: 'Matte Black', isDefault: true })
      .expect(200);
    expect(res.body).toMatchObject({ color: 'Matte Black', isDefault: true });
    const after = await api().get(VEHICLES).set('Authorization', owner.token).expect(200);
    expect(after.body.filter((v: { isDefault: boolean }) => v.isDefault)).toHaveLength(1);

    const unset = await api()
      .patch(`${VEHICLES}/${nonDefault.id}`)
      .set('Authorization', owner.token)
      .send({ isDefault: false })
      .expect(409);
    expect(unset.body.message).toBe('Choose another vehicle as default instead.');
  });

  it("never exposes another customer's vehicle (404 for read, edit and delete)", async () => {
    const mine = await api().get(VEHICLES).set('Authorization', owner.token).expect(200);
    const id = mine.body[0].id as string;
    await api().get(`${VEHICLES}/${id}`).set('Authorization', stranger.token).expect(404);
    await api()
      .patch(`${VEHICLES}/${id}`)
      .set('Authorization', stranger.token)
      .send({ color: 'Red' })
      .expect(404);
    await api().delete(`${VEHICLES}/${id}`).set('Authorization', stranger.token).expect(404);
    await api().get(`${VEHICLES}/not-a-uuid`).set('Authorization', owner.token).expect(400);
  });

  it('rejects attempts to move a vehicle to another customer (mass assignment)', async () => {
    const mine = await api().get(VEHICLES).set('Authorization', owner.token).expect(200);
    const res = await api()
      .patch(`${VEHICLES}/${mine.body[0].id}`)
      .set('Authorization', owner.token)
      .send({ customerId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    expect(res.body.message).toContain('property customerId should not exist');
  });

  it('removes a vehicle (soft delete), promotes a new default and frees the plate', async () => {
    const list = await api().get(VEHICLES).set('Authorization', owner.token).expect(200);
    const def = list.body.find((v: { isDefault: boolean }) => v.isDefault);
    await api().delete(`${VEHICLES}/${def.id}`).set('Authorization', owner.token).expect(204);

    const after = await api().get(VEHICLES).set('Authorization', owner.token).expect(200);
    expect(after.body.map((v: { id: string }) => v.id)).not.toContain(def.id);
    expect(after.body.filter((v: { isDefault: boolean }) => v.isDefault)).toHaveLength(1);
    await api().get(`${VEHICLES}/${def.id}`).set('Authorization', owner.token).expect(404);

    const [row]: { deleted_at: Date | null }[] = await t.ds.query(
      'SELECT deleted_at FROM customer_vehicles WHERE id = $1',
      [def.id],
    );
    expect(row.deleted_at).not.toBeNull(); // kept for booking history

    const { id: _id, isDefault: _d, createdAt: _c, ...again } = def;
    await api().post(VEHICLES).set('Authorization', owner.token).send(again).expect(201);
  });
});
