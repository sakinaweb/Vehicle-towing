import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  BookingStatus,
  CancelledBy,
  DriverAvailability,
  InspectionStage,
  OfferStatus,
  PaymentMethod,
} from '../../common/enums.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import { AuditService } from '../audit/audit.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { BookingStatusHistory } from '../bookings/entities/booking-status-history.entity.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { fromPoint } from '../locations/geo.js';
import { PricingRule } from '../pricing/entities/pricing-rule.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CustomerVehicle } from '../vehicles/entities/customer-vehicle.entity.js';
import {
  MATCHING_QUEUE,
  MatchingJob,
  MatchJobData,
  OfferTimeoutJobData,
  offerTimeoutJobId,
} from './dispatch.constants.js';
import { DriverJobView, OfferView } from './dispatch.dto.js';
import { BookingInspection } from './entities/booking-inspection.entity.js';
import { BookingOffer } from './entities/booking-offer.entity.js';
import { ACTIVE_TRIP_STATUSES, TRIP_STEPS, tripStepDecision, TripStep } from './trip.rules.js';

interface Candidate {
  driverId: string;
  userId: string;
  towTruckId: string;
  distanceMeters: number;
}

/** Side effects to run only after the transaction has committed. */
type AfterCommit = (() => Promise<void> | void)[];

/**
 * Automatic matching. PostgreSQL is the source of truth for who owns a booking;
 * BullMQ only schedules work (search, retry, offer timeout) and every job is
 * safe to run twice. Row locks are always taken in the same order —
 * booking → offer → driver — so concurrent accepts, declines, timeouts,
 * cancellations and drivers going offline serialise without deadlocks.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(MATCHING_QUEUE) private readonly queue: Queue,
    private readonly emitter: RealtimeEmitter,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  // ---------------------------------------------------------------- scheduling

  async enqueueMatch(bookingId: string, delayMs = 0): Promise<void> {
    const data: MatchJobData = { bookingId };
    await this.queue.add(MatchingJob.Match, data, {
      jobId: `match-${bookingId}-${randomUUID()}`,
      delay: delayMs,
      attempts: 3,
    });
  }

  private async scheduleOfferTimeout(offerId: string): Promise<void> {
    const data: OfferTimeoutJobData = { offerId };
    await this.queue.add(MatchingJob.OfferTimeout, data, {
      jobId: offerTimeoutJobId(offerId),
      delay: this.config.matching.offerTimeoutSeconds * 1000 + 250,
      attempts: 3,
    });
  }

  private async cancelOfferTimeout(offerId: string): Promise<void> {
    // Best effort: if it still runs, it finds the offer no longer pending and does nothing.
    await this.queue.remove(offerTimeoutJobId(offerId)).catch(() => undefined);
  }

  // ---------------------------------------------------------------- matching

  /** One matching step for a booking. Idempotent: safe to run again at any time. */
  async runMatch(bookingId: string): Promise<void> {
    const after: AfterCommit = [];
    await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) return; // deleted
      if (
        booking.status !== BookingStatus.Requested &&
        booking.status !== BookingStatus.Searching
      ) {
        return; // assigned or cancelled meanwhile
      }
      if (booking.paymentMethod !== PaymentMethod.Cash) {
        // Card / Apple Pay bookings are only dispatched once the funds are held.
        const [paid]: { status: string }[] = await em.query(
          `SELECT status FROM payments WHERE booking_id = $1 AND status IN ('authorized', 'captured')`,
          [booking.id],
        );
        if (!paid) return;
      }

      const pending = await em.findOne(BookingOffer, {
        where: { bookingId, status: OfferStatus.Pending },
        lock: { mode: 'pessimistic_write' },
      });
      if (pending) {
        if (pending.expiresAt > new Date()) return; // an attempt is in flight — no duplicate offer
        await em.update(BookingOffer, pending.id, {
          status: OfferStatus.Expired,
          respondedAt: new Date(),
        });
        after.push(() => this.notifyOfferClosed(pending, 'expired'));
      }

      const customerUserId = await this.customerUserId(em, booking.customerId);
      if (booking.status === BookingStatus.Requested) {
        await this.setBookingStatus(
          em,
          booking,
          BookingStatus.Searching,
          null,
          'Searching for a tow truck',
        );
        after.push(() => this.notifyCustomer(customerUserId, booking.id, BookingStatus.Searching));
      }

      const searchedFor = Date.now() - booking.createdAt.getTime();
      if (searchedFor > this.config.matching.maxSearchSeconds * 1000) {
        await em.update(Booking, booking.id, {
          status: BookingStatus.Cancelled,
          cancelledAt: new Date(),
          cancelledBy: CancelledBy.System,
          cancellationReason: 'No tow truck available nearby',
        });
        await em.insert(BookingStatusHistory, {
          bookingId: booking.id,
          fromStatus: BookingStatus.Searching,
          toStatus: BookingStatus.Cancelled,
          actorUserId: null,
          note: 'No tow truck available nearby',
        });
        after.push(() => this.notifyCustomer(customerUserId, booking.id, BookingStatus.Cancelled));
        after.push(() => this.payments.enqueueRelease(booking.id)); // release any card hold
        return;
      }

      const candidate = await this.findCandidate(em, booking.id);
      if (!candidate) {
        after.push(() =>
          this.enqueueMatch(booking.id, this.config.matching.retryDelaySeconds * 1000),
        );
        return;
      }

      const offer = await em.save(
        em.create(BookingOffer, {
          bookingId: booking.id,
          driverId: candidate.driverId,
          towTruckId: candidate.towTruckId,
          status: OfferStatus.Pending,
          distanceToPickupMeters: candidate.distanceMeters,
          expiresAt: new Date(Date.now() + this.config.matching.offerTimeoutSeconds * 1000),
        }),
      );
      after.push(async () => {
        await this.scheduleOfferTimeout(offer.id);
        const view = await this.offerView(this.dataSource.manager, offer.id);
        this.emitter.toUser(candidate.userId, RealtimeEvent.OfferNew, view);
      });
    });
    await this.runAfter(after);
  }

  /**
   * Nearest eligible driver within the search radius (PostGIS):
   * online, KYC-approved, active account, fresh location, an active truck of the
   * requested tow type, no job in progress, no other pending offer, and not
   * already offered this booking. The driver row is locked (SKIP LOCKED) so two
   * bookings matched at the same moment can't pick the same driver.
   */
  async findCandidate(em: EntityManager, bookingId: string): Promise<Candidate | null> {
    const { searchRadiusMeters, locationMaxAgeSeconds } = this.config.matching;
    const rows: Candidate[] = await em.query(
      `SELECT d.id AS "driverId", d.user_id AS "userId", t.id AS "towTruckId",
              ROUND(ST_Distance(d.current_location, b.pickup_point))::int AS "distanceMeters"
         FROM bookings b
         JOIN drivers d
           ON d.availability = 'online'
          AND d.kyc_status = 'approved'
          AND d.current_location IS NOT NULL
          AND d.location_updated_at > now() - make_interval(secs => $2)
          AND ST_DWithin(d.current_location, b.pickup_point, $3)
         JOIN users u ON u.id = d.user_id AND u.status = 'active'
         JOIN LATERAL (
              SELECT tt.id FROM tow_trucks tt
               WHERE tt.driver_id = d.id AND tt.is_active AND tt.tow_type = b.tow_type
               ORDER BY tt.created_at LIMIT 1
         ) t ON true
        WHERE b.id = $1
          AND NOT EXISTS (SELECT 1 FROM bookings ab
                           WHERE ab.driver_id = d.id AND ab.status NOT IN ('completed', 'cancelled'))
          AND NOT EXISTS (SELECT 1 FROM booking_offers o
                           WHERE o.booking_id = b.id AND o.driver_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM booking_offers po
                           WHERE po.driver_id = d.id AND po.status = 'pending')
        ORDER BY ST_Distance(d.current_location, b.pickup_point) ASC, d.location_updated_at DESC
        LIMIT 1
        FOR UPDATE OF d SKIP LOCKED`,
      [bookingId, locationMaxAgeSeconds, searchRadiusMeters],
    );
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------- offer outcomes

  /** Timeout job: an unanswered offer expires and the next driver is tried. */
  async expireOffer(offerId: string): Promise<void> {
    const after: AfterCommit = [];
    await this.dataSource.transaction(async (em) => {
      const peek = await em.findOneBy(BookingOffer, { id: offerId });
      if (!peek || peek.status !== OfferStatus.Pending) return;
      await em.findOne(Booking, {
        where: { id: peek.bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      const offer = await em.findOne(BookingOffer, {
        where: { id: offerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!offer || offer.status !== OfferStatus.Pending) return;
      await em.update(BookingOffer, offer.id, {
        status: OfferStatus.Expired,
        respondedAt: new Date(),
      });
      after.push(() => this.notifyOfferClosed(offer, 'expired'));
      after.push(() => this.enqueueMatch(offer.bookingId));
    });
    await this.runAfter(after);
  }

  /**
   * Driver accepts. Exactly one driver can ever own a booking: the booking row is
   * locked and only assigned if it is still searching with no driver. Repeating
   * an accepted offer returns the same job (idempotent).
   */
  async accept(userId: string, offerId: string): Promise<DriverJobView> {
    const after: AfterCommit = [];
    const bookingId = await this.dataSource.transaction(async (em) => {
      const { offer, driver } = await this.lockOwnOffer(em, userId, offerId);

      if (offer.status === OfferStatus.Accepted) return offer.bookingId; // idempotent replay
      if (offer.status !== OfferStatus.Pending) {
        throw new ConflictException('This job offer is no longer available.');
      }
      if (offer.expiresAt <= new Date()) {
        await em.update(BookingOffer, offer.id, {
          status: OfferStatus.Expired,
          respondedAt: new Date(),
        });
        after.push(() => this.enqueueMatch(offer.bookingId));
        throw new ConflictException('This job offer has expired.');
      }
      if (driver.availability !== DriverAvailability.Online) {
        throw new ConflictException('Go online to accept jobs.');
      }

      const booking = await em.findOneByOrFail(Booking, { id: offer.bookingId });
      if (booking.status !== BookingStatus.Searching || booking.driverId) {
        await em.update(BookingOffer, offer.id, {
          status: OfferStatus.Cancelled,
          respondedAt: new Date(),
        });
        throw new ConflictException('This job offer is no longer available.');
      }

      const now = new Date();
      await em.update(BookingOffer, offer.id, { status: OfferStatus.Accepted, respondedAt: now });
      await em.update(Booking, booking.id, {
        driverId: driver.id,
        towTruckId: offer.towTruckId,
        assignedAt: now,
      });
      await this.setBookingStatus(
        em,
        booking,
        BookingStatus.DriverAssigned,
        userId,
        'Driver accepted the job',
      );
      await em.update(Driver, driver.id, { availability: DriverAvailability.Busy });

      const customerUserId = await this.customerUserId(em, booking.customerId);
      after.push(() => this.cancelOfferTimeout(offer.id));
      after.push(() =>
        this.notifyCustomer(customerUserId, booking.id, BookingStatus.DriverAssigned),
      );
      return booking.id;
    });
    // Commit first: the assignment must not depend on a follow-up failing (e.g. in a test that closes).
    await this.runAfter(after);
    return this.jobView(this.dataSource.manager, bookingId);
  }

  /** Driver declines: the next nearest driver is offered the job right away. */
  async decline(userId: string, offerId: string): Promise<void> {
    const after: AfterCommit = [];
    await this.dataSource.transaction(async (em) => {
      const { offer } = await this.lockOwnOffer(em, userId, offerId);
      if (offer.status === OfferStatus.Declined) return; // idempotent
      if (offer.status !== OfferStatus.Pending) {
        throw new ConflictException('This job offer is no longer available.');
      }
      await em.update(BookingOffer, offer.id, {
        status: OfferStatus.Declined,
        respondedAt: new Date(),
      });
      after.push(() => this.cancelOfferTimeout(offer.id));
      after.push(() => this.enqueueMatch(offer.bookingId));
    });
    await this.runAfter(after);
  }

  /** Driver starts driving to the pickup: driver_assigned → driver_arriving. */
  /**
   * The assigned driver moves their job one step (see TRIP_STEPS). Locks booking → driver,
   * validates the current state, and is idempotent: repeating the last step returns the job.
   */
  async advanceTrip(userId: string, bookingId: string, step: TripStep): Promise<DriverJobView> {
    const rule = TRIP_STEPS[step];
    const after: AfterCommit = [];
    await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      const driver = await em.findOneBy(Driver, { userId });
      if (!booking || !driver || booking.driverId !== driver.id) {
        throw new NotFoundException('Job not found.'); // another driver's job looks the same
      }
      const decision = tripStepDecision(booking.status, step);
      if (decision.kind === 'already-done') return;
      if (decision.kind === 'invalid') throw new ConflictException(decision.message);
      if (rule.requires) {
        const inspection = await em.findOneBy(BookingInspection, {
          bookingId,
          stage: rule.requires,
        });
        if (!inspection?.submittedAt) {
          throw new ConflictException(`Submit the ${rule.requires} inspection first.`);
        }
      }
      const from = booking.status;
      await this.setBookingStatus(em, booking, rule.to, userId, rule.note);
      const completed = rule.to === BookingStatus.Completed;
      if (completed) {
        await em.update(Booking, booking.id, { completedAt: new Date() });
        // Ledger entry + invoice commit together with the completion; capture runs after.
        after.push(await this.payments.onTripCompleted(em, booking));
      }
      await em.findOne(Driver, { where: { id: driver.id }, lock: { mode: 'pessimistic_write' } });
      await em.update(Driver, driver.id, {
        availability: rule.availability,
        ...(completed && { totalTrips: () => 'total_trips + 1' }),
      });
      const customerUserId = await this.customerUserId(em, booking.customerId);
      after.push(() => this.notifyCustomer(customerUserId, booking.id, rule.to));
      after.push(() =>
        this.audit.record({
          action: rule.audit,
          entityType: 'booking',
          entityId: booking.id,
          actorUserId: userId,
          metadata: { from, to: rule.to },
        }),
      );
    });
    await this.runAfter(after);
    return this.jobView(this.dataSource.manager, bookingId);
  }

  /**
   * Withdraws a driver's pending offer (driver going offline) inside the caller's
   * transaction, locking booking → offer first. The booking is re-matched after commit.
   */
  async withdrawPendingOfferForDriver(em: EntityManager, driverId: string, after: AfterCommit) {
    const peek = await em.findOneBy(BookingOffer, { driverId, status: OfferStatus.Pending });
    if (!peek) return;
    await em.findOne(Booking, {
      where: { id: peek.bookingId },
      lock: { mode: 'pessimistic_write' },
    });
    const offer = await em.findOne(BookingOffer, {
      where: { id: peek.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!offer || offer.status !== OfferStatus.Pending) return;
    await em.update(BookingOffer, offer.id, {
      status: OfferStatus.Cancelled,
      respondedAt: new Date(),
    });
    after.push(() => this.cancelOfferTimeout(offer.id));
    after.push(() => this.enqueueMatch(offer.bookingId));
  }

  // ---------------------------------------------------------------- reads (driver)

  async currentOffer(userId: string): Promise<OfferView | null> {
    const em = this.dataSource.manager;
    const driver = await this.driverOf(em, userId);
    const offer = await em
      .createQueryBuilder(BookingOffer, 'o')
      .where('o.driver_id = :driverId', { driverId: driver.id })
      .andWhere('o.status = :status', { status: OfferStatus.Pending })
      .andWhere('o.expires_at > now()')
      .getOne();
    return offer ? this.offerView(em, offer.id) : null;
  }

  async currentJob(userId: string): Promise<DriverJobView | null> {
    const em = this.dataSource.manager;
    const driver = await this.driverOf(em, userId);
    const booking = await em
      .createQueryBuilder(Booking, 'b')
      .where('b.driver_id = :driverId', { driverId: driver.id })
      .andWhere('b.status IN (:...statuses)', { statuses: ACTIVE_TRIP_STATUSES })
      .orderBy('b.assigned_at', 'DESC')
      .getOne();
    return booking ? this.jobView(em, booking.id) : null;
  }

  // ---------------------------------------------------------------- helpers

  private async lockOwnOffer(em: EntityManager, userId: string, offerId: string) {
    const driver = await this.driverOf(em, userId);
    const peek = await em.findOneBy(BookingOffer, { id: offerId, driverId: driver.id });
    if (!peek) throw new NotFoundException('Job offer not found.'); // someone else's offer looks the same
    await em.findOne(Booking, {
      where: { id: peek.bookingId },
      lock: { mode: 'pessimistic_write' },
    });
    const offer = await em.findOneOrFail(BookingOffer, {
      where: { id: offerId },
      lock: { mode: 'pessimistic_write' },
    });
    const lockedDriver = await em.findOneOrFail(Driver, {
      where: { id: driver.id },
      lock: { mode: 'pessimistic_write' },
    });
    return { offer, driver: lockedDriver };
  }

  private async driverOf(em: EntityManager, userId: string): Promise<Driver> {
    const driver = await em.findOneBy(Driver, { userId });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    return driver;
  }

  private async customerUserId(em: EntityManager, customerId: string): Promise<string> {
    return (await em.findOneByOrFail(Customer, { id: customerId })).userId;
  }

  private async setBookingStatus(
    em: EntityManager,
    booking: Booking,
    to: BookingStatus,
    actorUserId: string | null,
    note: string,
  ): Promise<void> {
    await em.update(Booking, booking.id, { status: to });
    await em.insert(BookingStatusHistory, {
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: to,
      actorUserId,
      note,
    });
    booking.status = to;
  }

  async jobView(em: EntityManager, bookingId: string): Promise<DriverJobView> {
    const booking = await em.findOneByOrFail(Booking, { id: bookingId });
    const vehicle = await em.findOneOrFail(CustomerVehicle, {
      where: { id: booking.customerVehicleId },
      withDeleted: true,
    });
    const rule = await em.findOneByOrFail(PricingRule, { id: booking.pricingRuleId });
    const customer = await em.findOneByOrFail(Customer, { id: booking.customerId });
    const user = await em.findOneByOrFail(User, { id: customer.userId });
    const inspections = await em.findBy(BookingInspection, { bookingId });
    const inspectionState = (stage: InspectionStage) => {
      const i = inspections.find((x) => x.stage === stage);
      return !i ? 'none' : i.submittedAt ? 'submitted' : 'draft';
    };
    const commission = Math.round((booking.subtotalFils * rule.platformCommissionBps) / 10_000);
    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      towType: booking.towType,
      issue: booking.issue,
      notes: booking.notes,
      vehicle: {
        category: vehicle.category,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        plate: `${vehicle.plateEmirate} ${vehicle.plateCode} ${vehicle.plateNumber}`,
      },
      pickup: { ...fromPoint(booking.pickupPoint), address: booking.pickupAddress },
      dropoff: { ...fromPoint(booking.dropoffPoint), address: booking.dropoffAddress },
      tripDistanceMeters: booking.distanceMeters,
      fareTotalFils: booking.totalFils,
      driverPayoutFils: booking.subtotalFils - commission,
      currency: booking.currency,
      customerFirstName: user.fullName?.split(' ')[0] ?? 'Customer',
      paymentMethod: booking.paymentMethod,
      inspections: {
        pickup: inspectionState(InspectionStage.Pickup),
        return: inspectionState(InspectionStage.Return),
      },
    };
  }

  async offerView(em: EntityManager, offerId: string): Promise<OfferView> {
    const offer = await em.findOneByOrFail(BookingOffer, { id: offerId });
    return {
      ...(await this.jobView(em, offer.bookingId)),
      offerId: offer.id,
      offerStatus: offer.status,
      distanceToPickupMeters: offer.distanceToPickupMeters,
      expiresAt: offer.expiresAt,
    };
  }

  private async notifyOfferClosed(offer: BookingOffer, reason: string): Promise<void> {
    const driver = await this.dataSource.manager.findOneBy(Driver, { id: offer.driverId });
    if (driver) {
      this.emitter.toUser(driver.userId, RealtimeEvent.OfferClosed, { offerId: offer.id, reason });
    }
  }

  private notifyCustomer(customerUserId: string, bookingId: string, status: BookingStatus): void {
    this.emitter.toUser(customerUserId, RealtimeEvent.BookingUpdated, { bookingId, status });
  }

  private async runAfter(after: AfterCommit): Promise<void> {
    for (const fn of after) {
      try {
        await fn();
      } catch (err) {
        this.logger.error(`Post-commit step failed: ${String(err)}`);
      }
    }
  }
}

export type { AfterCommit };
