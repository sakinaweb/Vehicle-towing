import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { DriverAvailability } from '../../common/enums.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { ACTIVE_TRIP_STATUSES } from './trip.rules.js';
import { locationTimestampError } from './dispatch.rules.js';
import { LocationAcceptedView, LocationUpdateDto } from './dispatch.dto.js';

/** Stores the fix only if it is newer than the one already in Redis. */
const NEWER_WINS = `
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(cjson.decode(cur).ts or 0) >= tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1`;

export interface LatestLocation {
  lat: number;
  lng: number;
  recordedAt: string;
  accuracyMeters?: number;
  headingDegrees?: number;
}

/**
 * Driver positions. PostGIS (drivers.current_location) is the source of truth
 * used for matching; Redis keeps the latest fix for fast reads (live tracking)
 * and expires it when it goes stale. Every fix updates Redis; PostgreSQL is
 * written at most once per DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS per driver.
 * During a trip each accepted fix is pushed to that booking's customer only.
 */
@Injectable()
export class DriverLocationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  /** The driver is always resolved from the authenticated user — never from the request body. */
  async update(userId: string, dto: LocationUpdateDto): Promise<LocationAcceptedView> {
    const driver = await this.dataSource.manager.findOneBy(Driver, { userId });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    if (driver.availability === DriverAvailability.Offline) {
      throw new ConflictException('Go online to share your location.');
    }

    const now = new Date();
    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : now;
    const { locationMaxAgeSeconds: maxAge, locationDbWriteIntervalSeconds } = this.config.matching;
    const cached = await this.latest(driver.id);
    const lastRecordedAt = [driver.locationUpdatedAt, cached && new Date(cached.recordedAt)]
      .filter((d): d is Date => !!d)
      .reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
    const error = locationTimestampError(recordedAt, now, lastRecordedAt, maxAge);
    if (error) {
      throw error.startsWith('A newer')
        ? new ConflictException(error)
        : new BadRequestException(error);
    }

    const latest: LatestLocation = {
      lat: dto.lat,
      lng: dto.lng,
      recordedAt: recordedAt.toISOString(),
      ...(dto.accuracyMeters !== undefined && { accuracyMeters: dto.accuracyMeters }),
      ...(dto.headingDegrees !== undefined && { headingDegrees: dto.headingDegrees }),
    };
    // Atomic newest-wins: of two concurrent fixes, the older one is refused.
    const stored = await this.redis.eval(
      NEWER_WINS,
      1,
      this.key(driver.id),
      JSON.stringify({ ...latest, ts: recordedAt.getTime() }),
      String(recordedAt.getTime()),
      String(maxAge),
    );
    if (stored !== 1) throw new ConflictException('A newer location is already recorded.');

    // Throttled PostGIS write (skipped while the stored position is recent enough).
    await this.dataSource.query(
      `UPDATE drivers
          SET current_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
              location_updated_at = $4,
              updated_at = now()
        WHERE id = $1
          AND availability <> 'offline'
          AND (location_updated_at IS NULL OR location_updated_at < $4::timestamptz - make_interval(secs => $5::int))`,
      [driver.id, dto.lng, dto.lat, recordedAt, locationDbWriteIntervalSeconds],
    );

    if (driver.availability !== DriverAvailability.Online)
      await this.shareWithCustomer(driver.id, latest);
    return { lat: dto.lat, lng: dto.lng, recordedAt };
  }

  /** Pushes the fix to the customer whose trip this driver is working, if any. */
  private async shareWithCustomer(driverId: string, latest: LatestLocation): Promise<void> {
    const rows: { bookingId: string; customerUserId: string }[] = await this.dataSource.query(
      `SELECT b.id AS "bookingId", c.user_id AS "customerUserId"
         FROM bookings b JOIN customers c ON c.id = b.customer_id
        WHERE b.driver_id = $1 AND b.status = ANY($2::booking_status[])
        LIMIT 1`,
      [driverId, ACTIVE_TRIP_STATUSES],
    );
    if (rows[0]) {
      this.emitter.toUser(rows[0].customerUserId, RealtimeEvent.TripLocation, {
        bookingId: rows[0].bookingId,
        lat: latest.lat,
        lng: latest.lng,
        recordedAt: latest.recordedAt,
        ...(latest.headingDegrees !== undefined && { headingDegrees: latest.headingDegrees }),
      });
    }
  }

  /** Latest fresh fix from Redis, or null when the driver is offline / stale. */
  async latest(driverId: string): Promise<LatestLocation | null> {
    const raw = await this.redis.get(this.key(driverId));
    return raw ? (JSON.parse(raw) as LatestLocation) : null;
  }

  async forget(driverId: string): Promise<void> {
    await this.redis.del(this.key(driverId));
  }

  private key(driverId: string): string {
    return `driver:location:${driverId}`;
  }
}
