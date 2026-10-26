import { getQueueToken } from '@nestjs/bullmq';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { IsInt, IsString, Matches, Min } from 'class-validator';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { AppConfigService } from '../src/config/app-config.service.js';
import {
  HeartbeatResult,
  SYSTEM_QUEUE,
  SystemJob,
} from '../src/infrastructure/queue/queue.constants.js';
import { Public } from '../src/modules/auth/decorators.js';
import { createTestApp, deleteUsersByPhone, signInAs, TestApp } from './support/test-app.js';

/** Test-only route that exercises the global ValidationPipe with a realistic DTO. */
class ProbeDto {
  @Matches(/^\+9715\d{8}$/, { message: 'phone must be a UAE mobile number in E.164 format' })
  phone!: string;

  @IsString()
  plateCode!: string;

  @IsInt()
  @Min(1)
  year!: number;
}

@Public()
@Controller('validation-probe')
class ValidationProbeController {
  @Post()
  echo(@Body() dto: ProbeDto) {
    return dto;
  }
}

const EXPECTED_TABLES = [
  'audit_logs',
  'auth_sessions',
  'booking_status_history',
  'bookings',
  'chat_messages',
  'customer_vehicles',
  'customers',
  'driver_documents',
  'drivers',
  'notifications',
  'otp_challenges',
  'payments',
  'pricing_rules',
  'saved_locations',
  'service_zones',
  'tow_trucks',
  'users',
];

describe('TowNow API (e2e, real infrastructure)', () => {
  let t: TestApp;
  const phones: string[] = [];
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [ValidationProbeController] });
    ({ app, baseUrl } = t);
  });

  afterAll(async () => {
    if (t) await deleteUsersByPhone(t.ds, phones);
    await t?.close();
  });

  describe('health', () => {
    it('GET /api/health/live → 200', async () => {
      await request(baseUrl).get('/api/health/live').expect(200, { status: 'ok' });
    });

    it('GET /api/health/ready → every dependency up', async () => {
      const res = await request(baseUrl).get('/api/health/ready').expect(200);
      expect(res.body.status).toBe('ok');
      for (const key of ['database', 'postgis', 'redis', 'queue']) {
        expect(res.body.info[key].status).toBe('up');
      }
      expect(res.body.info.postgis.version).toMatch(/^3\./);
    });
  });

  describe('database', () => {
    it('has every table from the initial migration', async () => {
      const ds = t.ds;
      const rows: { table_name: string }[] = await ds.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const tables = rows.map((r) => r.table_name);
      expect(tables).toEqual(expect.arrayContaining(EXPECTED_TABLES));
      expect(tables).toContain('schema_migrations');
    });

    it('computes real geodesic distances with PostGIS (Downtown Dubai → Al Quoz ≈ 8 km)', async () => {
      const ds = t.ds;
      const [row]: { km: number }[] = await ds.query(
        `SELECT ST_Distance(
           ST_SetSRID(ST_MakePoint(55.2744, 25.1972), 4326)::geography,
           ST_SetSRID(ST_MakePoint(55.2266, 25.1386), 4326)::geography
         ) / 1000 AS km`,
      );
      expect(Number(row.km)).toBeGreaterThan(7);
      expect(Number(row.km)).toBeLessThan(9);
    });
  });

  describe('BullMQ', () => {
    it('round-trips a job through Redis to the worker and back', async () => {
      const queue = app.get<Queue>(getQueueToken(SYSTEM_QUEUE));
      const config = app.get(AppConfigService);
      const events = new QueueEvents(SYSTEM_QUEUE, {
        connection: { ...config.redis },
        prefix: config.queuePrefix,
      });
      try {
        await events.waitUntilReady();
        const job = await queue.add(SystemJob.Heartbeat, {});
        const result = (await job.waitUntilFinished(events, 15_000)) as HeartbeatResult;
        expect(result.ok).toBe(true);
        expect(Date.parse(result.processedAt)).not.toBeNaN();
      } finally {
        await events.close();
      }
    });
  });

  describe('Socket.IO', () => {
    it('refuses connections without a valid access token', async () => {
      for (const auth of [undefined, { token: 'not-a-jwt' }]) {
        const socket: Socket = io(`${baseUrl}/realtime`, {
          transports: ['websocket'],
          forceNew: true,
          reconnection: false,
          ...(auth && { auth }),
        });
        try {
          const err = await new Promise<Error>((resolve, reject) => {
            socket.on('connect_error', resolve);
            socket.on('connect', () => reject(new Error('connected without auth')));
          });
          expect(err.message).toBe('unauthorized');
        } finally {
          socket.close();
        }
      }
    });

    it('answers ping with pong for a signed-in user', async () => {
      const user = await signInAs(t, 'customer', phones);
      const socket: Socket = io(`${baseUrl}/realtime`, {
        transports: ['websocket'],
        forceNew: true,
        auth: { token: user.token },
      });
      try {
        const pong = await new Promise<{ serverTime: string }>((resolve, reject) => {
          socket.on('connect_error', reject);
          socket.on('pong', resolve);
          socket.on('connect', () => socket.emit('ping'));
        });
        expect(Date.parse(pong.serverTime)).not.toBeNaN();
      } finally {
        socket.close();
      }
    });
  });

  describe('validation & errors', () => {
    const valid = { phone: '+971501234567', plateCode: 'A', year: 2023 };

    it('accepts a valid payload', async () => {
      await request(baseUrl).post('/api/v1/validation-probe').send(valid).expect(201, valid);
    });

    it('rejects invalid fields with 400 and readable messages', async () => {
      const res = await request(baseUrl)
        .post('/api/v1/validation-probe')
        .send({ ...valid, phone: '0501234567', year: 'soon' })
        .expect(400);
      expect(res.body.error).toBe('BAD_REQUEST');
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'phone must be a UAE mobile number in E.164 format',
          expect.stringMatching(/^year must be an integer/),
        ]),
      );
    });

    it('rejects unknown properties (mass-assignment protection)', async () => {
      const res = await request(baseUrl)
        .post('/api/v1/validation-probe')
        .send({ ...valid, role: 'admin' })
        .expect(400);
      expect(res.body.message).toContain('property role should not exist');
    });

    it('returns the unified error shape for unknown routes', async () => {
      const res = await request(baseUrl).get('/api/v1/does-not-exist').expect(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: 'NOT_FOUND',
        path: '/api/v1/does-not-exist',
      });
      expect(typeof res.body.timestamp).toBe('string');
    });
  });

  describe('HTTP hardening', () => {
    it('sets security headers and allows only configured CORS origins', async () => {
      const allowed = await request(baseUrl)
        .get('/api/health/live')
        .set('Origin', 'http://localhost:3000');
      expect(allowed.headers['x-content-type-options']).toBe('nosniff');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

      const blocked = await request(baseUrl)
        .get('/api/health/live')
        .set('Origin', 'http://evil.example');
      expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('serves the OpenAPI document', async () => {
      const res = await request(baseUrl).get('/api/docs-json').expect(200);
      expect(res.body.info.title).toBe('TowNow API');
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining(['/api/health/live', '/api/health/ready']),
      );
    });
  });
});
