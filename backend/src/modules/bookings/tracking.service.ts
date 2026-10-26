import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { BookingStatus } from '../../common/enums.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { AuditService } from '../audit/audit.service.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { DriverLocationService } from '../dispatch/driver-location.service.js';
import { ACTIVE_TRIP_STATUSES } from '../dispatch/trip.rules.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { EtaResult, EtaService } from '../locations/eta.service.js';
import { fromPoint, LatLng } from '../locations/geo.js';
import { Booking } from './entities/booking.entity.js';

export class TrackedLocationView {
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty() recordedAt!: Date;
  @ApiProperty({ description: "Seconds since the driver's phone took this fix" })
  ageSeconds!: number;
  @ApiProperty({
    description: 'True when older than DRIVER_LOCATION_MAX_AGE_SECONDS: do not show as live',
  })
  stale!: boolean;
  @ApiPropertyOptional() headingDegrees?: number;
}

export class TripEtaView {
  @ApiProperty({ enum: ['pickup', 'dropoff'] }) target!: 'pickup' | 'dropoff';
  @ApiProperty({ enum: ['available', 'unavailable'] }) status!: 'available' | 'unavailable';
  @ApiPropertyOptional() durationSeconds?: number;
  @ApiPropertyOptional() distanceMeters?: number;
  @ApiPropertyOptional({ description: 'Routing provider, e.g. google, mapbox' }) source?: string;
  @ApiPropertyOptional({
    enum: ['not_configured', 'provider_error', 'no_route', 'location_unavailable'],
    description: 'Why there is no real ETA',
  })
  reason?: string;
}

export class DriverLocationView {
  @ApiProperty() bookingId!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiPropertyOptional({
    type: TrackedLocationView,
    nullable: true,
    description: 'Null if never reported',
  })
  location!: TrackedLocationView | null;
  @ApiPropertyOptional({
    type: TripEtaView,
    nullable: true,
    description:
      'To the pickup while the driver is coming, to the destination during the tow, else null',
  })
  eta!: TripEtaView | null;
}

const ETA_CACHE_SECONDS = 30;

/** The customer's live view of the driver working their booking. */
@Injectable()
export class TrackingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly locations: DriverLocationService,
    private readonly eta: EtaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async driverLocation(userId: string, bookingId: string): Promise<DriverLocationView> {
    const em = this.dataSource.manager;
    const customer = await em.findOneBy(Customer, { userId });
    const booking = await em.findOneBy(Booking, { id: bookingId });
    if (!booking || !customer || booking.customerId !== customer.id) {
      if (booking) {
        await this.audit.record({
          action: 'security.trip_location_denied',
          entityType: 'booking',
          entityId: bookingId,
          actorUserId: userId,
        });
      }
      throw new NotFoundException('Booking not found.');
    }
    if (!booking.driverId || !ACTIVE_TRIP_STATUSES.includes(booking.status)) {
      throw new ConflictException('No driver is on this booking right now.');
    }

    const location = await this.currentLocation(booking.driverId);
    const target =
      booking.status === BookingStatus.InTransit
        ? ('dropoff' as const)
        : booking.status === BookingStatus.DriverAssigned ||
            booking.status === BookingStatus.DriverArriving
          ? ('pickup' as const)
          : null;

    let eta: TripEtaView | null = null;
    if (target) {
      if (!location || location.stale) {
        eta = { target, status: 'unavailable', reason: 'location_unavailable' };
      } else {
        const to = fromPoint(target === 'pickup' ? booking.pickupPoint : booking.dropoffPoint);
        eta = { target, ...(await this.cachedEta(booking.id, target, location, to)) };
      }
    }
    return { bookingId: booking.id, status: booking.status, location, eta };
  }

  /** Redis holds the latest fix; PostGIS is the fallback (likely stale) when Redis expired it. */
  private async currentLocation(driverId: string): Promise<TrackedLocationView | null> {
    const maxAge = this.config.matching.locationMaxAgeSeconds;
    const cached = await this.locations.latest(driverId);
    let fix: { lat: number; lng: number; recordedAt: Date; headingDegrees?: number } | null = null;
    if (cached) {
      fix = { lat: cached.lat, lng: cached.lng, recordedAt: new Date(cached.recordedAt) };
      if (cached.headingDegrees !== undefined) fix.headingDegrees = cached.headingDegrees;
    } else {
      const driver = await this.dataSource.manager.findOneBy(Driver, { id: driverId });
      if (driver?.currentLocation && driver.locationUpdatedAt) {
        fix = { ...fromPoint(driver.currentLocation), recordedAt: driver.locationUpdatedAt };
      }
    }
    if (!fix) return null;
    const ageSeconds = Math.max(0, Math.round((Date.now() - fix.recordedAt.getTime()) / 1000));
    return { ...fix, ageSeconds, stale: ageSeconds > maxAge };
  }

  /** Routing providers bill per call, so one ETA per booking and target is reused for 30 s. */
  private async cachedEta(
    bookingId: string,
    target: string,
    from: LatLng,
    to: LatLng,
  ): Promise<EtaResult> {
    const key = `trip:eta:${bookingId}:${target}`;
    const hit = await this.redis.get(key);
    if (hit) return JSON.parse(hit) as EtaResult;
    const result = await this.eta.estimate({ lat: from.lat, lng: from.lng }, to);
    if (result.status === 'available') {
      await this.redis.set(key, JSON.stringify(result), 'EX', ETA_CACHE_SECONDS);
    }
    return result;
  }
}
