import request from 'supertest';
import { createTestApp, deleteUsersByPhone, TestApp, uniquePhone } from './support/test-app.js';

describe('Profiles & roles (e2e)', () => {
  let t: TestApp;
  const phones: string[] = [];
  let customer: { token: string; phone: string };
  let driver: { token: string; phone: string };
  let otherDriver: { token: string; phone: string };

  async function signIn(role: 'customer' | 'driver') {
    const phone = uniquePhone();
    phones.push(phone);
    await request(t.baseUrl).post('/api/v1/auth/otp/request').send({ phone }).expect(202);
    const res = await request(t.baseUrl)
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: t.sms.lastCode(phone), role })
      .expect(200);
    return { token: `Bearer ${res.body.accessToken as string}`, phone };
  }

  const api = () => request(t.baseUrl);

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn('customer');
    driver = await signIn('driver');
    otherDriver = await signIn('driver');
  });

  afterAll(async () => {
    await deleteUsersByPhone(t.ds, phones);
    await t.close();
  });

  describe('role-based access', () => {
    it('requires authentication', async () => {
      await api().get('/api/v1/customers/me').expect(401);
      await api().get('/api/v1/drivers/me').expect(401);
    });

    it('keeps customers out of driver endpoints and vice versa', async () => {
      const a = await api()
        .get('/api/v1/drivers/me')
        .set('Authorization', customer.token)
        .expect(403);
      expect(a.body.message).toBe('You do not have access to this resource.');
      await api().get('/api/v1/customers/me').set('Authorization', driver.token).expect(403);
      await api()
        .post('/api/v1/drivers/me/tow-trucks')
        .set('Authorization', customer.token)
        .send({})
        .expect(403);
    });
  });

  describe('customer profile', () => {
    it('returns the profile created at sign-up', async () => {
      const res = await api()
        .get('/api/v1/customers/me')
        .set('Authorization', customer.token)
        .expect(200);
      expect(res.body).toEqual({
        user: expect.objectContaining({
          phone: customer.phone,
          role: 'customer',
          fullName: null,
          email: null,
        }),
        defaultPaymentMethod: null,
      });
    });

    it('updates name, email (normalised) and payment method', async () => {
      const res = await api()
        .patch('/api/v1/customers/me')
        .set('Authorization', customer.token)
        .send({
          fullName: '  Rashid   Al-Maktoum ',
          email: ' Rashid@Example.AE ',
          defaultPaymentMethod: 'apple_pay',
        })
        .expect(200);
      expect(res.body.user).toMatchObject({
        fullName: 'Rashid Al-Maktoum',
        email: 'rashid@example.ae',
      });
      expect(res.body.defaultPaymentMethod).toBe('apple_pay');

      const again = await api()
        .get('/api/v1/customers/me')
        .set('Authorization', customer.token)
        .expect(200);
      expect(again.body.user.fullName).toBe('Rashid Al-Maktoum');
    });

    it('accepts Arabic names and clearing the email', async () => {
      const res = await api()
        .patch('/api/v1/customers/me')
        .set('Authorization', customer.token)
        .send({ fullName: 'راشد المكتوم', email: null })
        .expect(200);
      expect(res.body.user).toMatchObject({ fullName: 'راشد المكتوم', email: null });
    });

    it('validates input and refuses fields it does not own', async () => {
      const res = await api()
        .patch('/api/v1/customers/me')
        .set('Authorization', customer.token)
        .send({ fullName: '<script>', email: 'not-an-email', defaultPaymentMethod: 'bitcoin' })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'fullName may only contain letters, spaces, apostrophes, dots and hyphens',
          'email must be a valid email address',
          expect.stringMatching(/^defaultPaymentMethod must be one of/),
        ]),
      );
      // Privilege escalation attempt via mass assignment.
      const esc = await api()
        .patch('/api/v1/customers/me')
        .set('Authorization', customer.token)
        .send({ role: 'admin', phone: '+971500000000' })
        .expect(400);
      expect(esc.body.message).toEqual(
        expect.arrayContaining([
          'property role should not exist',
          'property phone should not exist',
        ]),
      );
    });

    it('refuses an email already used by another account', async () => {
      await api()
        .patch('/api/v1/drivers/me')
        .set('Authorization', driver.token)
        .send({ email: 'shared@example.ae' })
        .expect(200);
      const res = await api()
        .patch('/api/v1/customers/me')
        .set('Authorization', customer.token)
        .send({ email: 'SHARED@example.ae' })
        .expect(409);
      expect(res.body.message).toBe('This email is already used by another account.');
    });
  });

  describe('driver profile & tow trucks', () => {
    const truck = {
      towType: 'flatbed',
      model: 'Isuzu NPR Hydraulic Flatbed',
      year: 2023,
      plateEmirate: 'Dubai',
      plateCode: ' k ',
      plateNumber: String(Date.now() % 100000),
    };
    let truckId: string;

    it('starts with a pending KYC, offline, and no trucks', async () => {
      const res = await api()
        .get('/api/v1/drivers/me')
        .set('Authorization', driver.token)
        .expect(200);
      expect(res.body).toMatchObject({
        user: { phone: driver.phone, role: 'driver' },
        kycStatus: 'pending',
        availability: 'offline',
        rating: null,
        totalTrips: 0,
        towTrucks: [],
      });
    });

    it('updates name and experience', async () => {
      const res = await api()
        .patch('/api/v1/drivers/me')
        .set('Authorization', driver.token)
        .send({ fullName: 'Tariq Al-Mansouri', experienceYears: 6 })
        .expect(200);
      expect(res.body).toMatchObject({
        user: { fullName: 'Tariq Al-Mansouri' },
        experienceYears: 6,
      });
    });

    it('registers a tow truck (plate normalised) and lists it on the profile', async () => {
      const res = await api()
        .post('/api/v1/drivers/me/tow-trucks')
        .set('Authorization', driver.token)
        .send(truck)
        .expect(201);
      expect(res.body).toMatchObject({ ...truck, plateCode: 'K', isActive: true });
      truckId = res.body.id;

      const profile = await api()
        .get('/api/v1/drivers/me')
        .set('Authorization', driver.token)
        .expect(200);
      expect(profile.body.towTrucks).toHaveLength(1);
    });

    it('refuses a plate that is already registered (even by another driver)', async () => {
      const res = await api()
        .post('/api/v1/drivers/me/tow-trucks')
        .set('Authorization', otherDriver.token)
        .send({ ...truck, plateCode: 'K' })
        .expect(409);
      expect(res.body.message).toBe('A tow truck with this plate is already registered.');
    });

    it('validates truck details', async () => {
      const res = await api()
        .post('/api/v1/drivers/me/tow-trucks')
        .set('Authorization', driver.token)
        .send({
          towType: 'helicopter',
          model: 'x',
          year: 1950,
          plateEmirate: 'Narnia',
          plateCode: 'TOOLONG',
          plateNumber: '1234567',
        })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^towType must be one of/),
          'model must be longer than or equal to 2 characters',
          'year must not be less than 1980',
          expect.stringMatching(/^plateEmirate must be one of/),
          'plateCode must be 1–3 letters or digits',
          'plateNumber must be 1–5 digits',
        ]),
      );
    });

    it('lets the owner deactivate the truck', async () => {
      const res = await api()
        .patch(`/api/v1/drivers/me/tow-trucks/${truckId}`)
        .set('Authorization', driver.token)
        .send({ isActive: false })
        .expect(200);
      expect(res.body.isActive).toBe(false);
    });

    it("hides other drivers' trucks (404, not 403)", async () => {
      await api()
        .patch(`/api/v1/drivers/me/tow-trucks/${truckId}`)
        .set('Authorization', otherDriver.token)
        .send({ isActive: true })
        .expect(404);
      await api()
        .delete(`/api/v1/drivers/me/tow-trucks/${truckId}`)
        .set('Authorization', otherDriver.token)
        .expect(404);
      await api()
        .delete('/api/v1/drivers/me/tow-trucks/not-a-uuid')
        .set('Authorization', driver.token)
        .expect(400);
    });

    it('caps the fleet size per driver', async () => {
      for (let i = 1; i <= 4; i++) {
        await api()
          .post('/api/v1/drivers/me/tow-trucks')
          .set('Authorization', driver.token)
          .send({ ...truck, plateCode: `Z${i}` })
          .expect(201);
      }
      const res = await api()
        .post('/api/v1/drivers/me/tow-trucks')
        .set('Authorization', driver.token)
        .send({ ...truck, plateCode: 'Z9' })
        .expect(409);
      expect(res.body.message).toBe('A driver account can register up to 5 tow trucks.');
    });

    it('lets the owner remove a truck', async () => {
      await api()
        .delete(`/api/v1/drivers/me/tow-trucks/${truckId}`)
        .set('Authorization', driver.token)
        .expect(204);
      const list = await api()
        .get('/api/v1/drivers/me/tow-trucks')
        .set('Authorization', driver.token)
        .expect(200);
      expect(list.body.map((x: { id: string }) => x.id)).not.toContain(truckId);
    });
  });
});
