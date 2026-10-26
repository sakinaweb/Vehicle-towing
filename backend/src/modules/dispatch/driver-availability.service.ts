import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { DriverAvailability, KycStatus } from '../../common/enums.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { TowTruck } from '../drivers/entities/tow-truck.entity.js';
import { MATCHING_QUEUE, MatchingJob } from './dispatch.constants.js';
import { availabilityChangeError, staleLocationAction } from './dispatch.rules.js';
import { AvailabilityView, SetAvailabilityDto } from './dispatch.dto.js';
import { DriverLocationService } from './driver-location.service.js';
import { AfterCommit, MatchingService } from './matching.service.js';

@Injectable()
export class DriverAvailabilityService implements OnModuleInit {
  private readonly logger = new Logger(DriverAvailabilityService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(MATCHING_QUEUE) private readonly queue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
    private readonly emitter: RealtimeEmitter,
    private readonly matching: MatchingService,
    private readonly locations: DriverLocationService,
  ) {}

  /** Runs the stale-GPS sweep every minute (idempotent: one scheduler however many processes start). */
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      MatchingJob.StaleLocationSweep,
      { every: 60_000 },
      { name: MatchingJob.StaleLocationSweep },
    );
  }

  /**
   * Online drivers (not on a job) whose GPS stopped updating — usually the phone stopped
   * the app in the background. They are warned once (push), then set offline so the
   * dispatch map and matching don't count a driver who can't be reached.
   */
  async sweepStaleLocations(): Promise<void> {
    const { locationMaxAgeSeconds: maxAge, staleOfflineSeconds } = this.config.matching;
    // updated_at also moves when the driver goes online, so a driver who just went online
    // isn't judged by yesterday's fix.
    const rows: { userId: string; driverId: string; since: Date; ageSeconds: number }[] =
      await this.dataSource.query(
        `SELECT user_id AS "userId", id AS "driverId",
                GREATEST(location_updated_at, updated_at) AS since,
                EXTRACT(EPOCH FROM now() - GREATEST(location_updated_at, updated_at))::int AS "ageSeconds"
           FROM drivers
          WHERE availability = 'online'
            AND GREATEST(location_updated_at, updated_at) < now() - make_interval(secs => $1)`,
        [maxAge],
      );
    for (const d of rows) {
      const action = staleLocationAction(d.ageSeconds, maxAge, staleOfflineSeconds);
      if (action === 'offline') {
        try {
          await this.set(d.userId, { status: DriverAvailability.Offline });
        } catch (err) {
          if (err instanceof ConflictException) continue; // took a job meanwhile
          throw err;
        }
        this.emitter.toUser(d.userId, RealtimeEvent.DriverLocationStale, { setOffline: true });
        this.logger.log(`Driver ${d.driverId} set offline: no GPS for ${d.ageSeconds}s`);
      } else if (action === 'warn') {
        // One warning per stale spell (the key names when the spell started).
        const key = `driver:stale-warned:${d.driverId}:${new Date(d.since).getTime()}`;
        if (await this.redis.set(key, '1', 'EX', 86_400, 'NX')) {
          this.emitter.toUser(d.userId, RealtimeEvent.DriverLocationStale, { setOffline: false });
        }
      }
    }
  }

  async get(userId: string): Promise<AvailabilityView> {
    const driver = await this.dataSource.manager.findOneBy(Driver, { userId });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    return { availability: driver.availability, locationUpdatedAt: driver.locationUpdatedAt };
  }

  /** Online / offline toggle. Busy and en-route are set by dispatch, never by the driver. */
  async set(userId: string, dto: SetAvailabilityDto): Promise<AvailabilityView> {
    const after: AfterCommit = [];
    const view = await this.dataSource.transaction(async (em) => {
      const peek = await em.findOneBy(Driver, { userId });
      if (!peek) throw new NotFoundException('Driver profile not found.');

      // Lock order booking → offer → driver (see MatchingService).
      if (dto.status === DriverAvailability.Offline) {
        await this.matching.withdrawPendingOfferForDriver(em, peek.id, after);
      }
      const driver = await em.findOneOrFail(Driver, {
        where: { id: peek.id },
        lock: { mode: 'pessimistic_write' },
      });

      const hasActiveTruck =
        (await em.countBy(TowTruck, { driverId: driver.id, isActive: true })) > 0;
      const error = availabilityChangeError(driver.availability, dto.status, {
        kycApproved: driver.kycStatus === KycStatus.Approved,
        hasActiveTruck,
      });
      if (
        error &&
        dto.status === DriverAvailability.Online &&
        driver.kycStatus === KycStatus.Rejected
      ) {
        throw new ConflictException(
          `Your verification was not approved: ${driver.kycRejectionReason ?? 'see your documents'}. Upload corrected documents to resubmit.`,
        );
      }
      if (error) throw new ConflictException(error);

      if (driver.availability !== dto.status) {
        await em.update(Driver, driver.id, { availability: dto.status });
      }
      if (dto.status === DriverAvailability.Offline) {
        after.push(() => this.locations.forget(driver.id)); // stop exposing the last position
      }
      return { availability: dto.status, locationUpdatedAt: driver.locationUpdatedAt };
    });
    for (const fn of after) await fn();
    return view;
  }
}
