import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In, Not } from 'typeorm';
import {
  BookingStatus,
  CancelledBy,
  DriverAvailability,
  OfferStatus,
  PaymentMethod,
} from '../../common/enums.js';
import { Payment } from '../payments/entities/payment.entity.js';
import { PaymentsService } from '../payments/payments.service.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import { BookingOffer } from '../dispatch/entities/booking-offer.entity.js';
import { MatchingService } from '../dispatch/matching.service.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { fromPoint, toPoint } from '../locations/geo.js';
import { isUniqueViolation } from '../users/users.service.js';
import { CustomerVehicle } from '../vehicles/entities/customer-vehicle.entity.js';
import { CustomerVehiclesService } from '../vehicles/customer-vehicles.service.js';
import { CustomerVehicleView } from '../vehicles/vehicle.dto.js';
import {
  BookingListView,
  BookingView,
  CreateBookingDto,
  ListBookingsQuery,
} from './booking.dto.js';
import {
  cancellationFeeMayApply,
  customerCanCancel,
  FINAL_STATUSES,
  formatBookingNumber,
  isTowTypeCompatible,
} from './booking.rules.js';
import { BookingStatusHistory } from './entities/booking-status-history.entity.js';
import { Booking } from './entities/booking.entity.js';
import { QuotesService, StoredQuote } from './quotes.service.js';

export interface CreateResult {
  booking: BookingView;
  /** False when the same quote was already booked (safe retry / double submit). */
  created: boolean;
}

@Injectable()
export class BookingsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly quotes: QuotesService,
    private readonly vehicles: CustomerVehiclesService,
    private readonly audit: AuditService,
    private readonly matching: MatchingService,
    private readonly emitter: RealtimeEmitter,
    private readonly payments: PaymentsService,
  ) {}

  async create(userId: string, dto: CreateBookingDto): Promise<CreateResult> {
    const customer = await this.vehicles.customerOf(this.dataSource.manager, userId);

    const replay = await this.findByQuote(customer, dto.quoteId);
    if (replay) return { booking: replay, created: false };

    if (dto.paymentMethod !== PaymentMethod.Cash && !this.payments.cardPaymentsEnabled) {
      throw new BadRequestException(
        'Card and Apple Pay are not available yet. Please choose cash.',
      );
    }

    const quote = await this.quotes.find(dto.quoteId);
    if (!quote) {
      // A concurrent submit of the same quote may have just booked it (and discarded the quote).
      const booked = await this.findByQuote(customer, dto.quoteId);
      if (booked) return { booking: booked, created: false };
    }
    if (!quote || quote.customerId !== customer.id) {
      // An expired quote and someone else's quote look the same from outside.
      throw new GoneException('This price has expired. Please get a new quote.');
    }

    let bookingId: string;
    try {
      bookingId = await this.dataSource.transaction((em) =>
        this.insertFromQuote(em, userId, customer, quote, dto),
      );
    } catch (err) {
      if (isUniqueViolation(err, 'uq_bookings_quote')) {
        // Two submits raced; the other one won — return its booking.
        const existing = await this.findByQuote(customer, dto.quoteId);
        if (existing) return { booking: existing, created: false };
      }
      if (isUniqueViolation(err, 'uq_bookings_active_vehicle')) {
        throw new ConflictException(
          'This vehicle already has an active tow request. Open it from My Orders.',
        );
      }
      throw err;
    }

    await this.quotes.discard(quote.id);
    if (dto.paymentMethod === PaymentMethod.Cash) {
      // Start automatic matching (BullMQ); the booking is safe in PostgreSQL even if this is retried.
      await this.matching.enqueueMatch(bookingId);
    } else {
      // Card / Apple Pay: matching starts once the gateway confirms the authorisation.
      await this.payments.startOnlinePayment(bookingId);
    }
    const booking = await this.loadView(this.dataSource.manager, customer.id, bookingId, true);
    await this.audit.record({
      action: 'booking.created',
      entityType: 'booking',
      entityId: bookingId,
      actorUserId: userId,
      metadata: { bookingNumber: booking.bookingNumber, totalFils: booking.fare.totalFils },
    });
    return { booking, created: true };
  }

  async list(userId: string, query: ListBookingsQuery): Promise<BookingListView> {
    const em = this.dataSource.manager;
    const customer = await this.vehicles.customerOf(em, userId);
    const where: FindOptionsWhere<Booking> = { customerId: customer.id };
    if (query.status === 'active') where.status = Not(In([...FINAL_STATUSES]));
    if (query.status === 'completed') where.status = BookingStatus.Completed;
    if (query.status === 'cancelled') where.status = BookingStatus.Cancelled;

    const [rows, total] = await em.findAndCount(Booking, {
      where,
      relations: { customerVehicle: true, driver: { user: true }, towTruck: true },
      withDeleted: true, // removed vehicles still show on past bookings
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const payments = await em.findBy(Payment, { bookingId: In(rows.map((r) => r.id)) });
    return {
      items: rows.map((b) => {
        const view = BookingsService.toView(b, b.customerVehicle);
        const payment = payments.find((p) => p.bookingId === b.id);
        view.payment = payment ? PaymentsService.summary(payment) : null;
        return view;
      }),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(userId: string, bookingId: string): Promise<BookingView> {
    const em = this.dataSource.manager;
    const customer = await this.vehicles.customerOf(em, userId);
    return this.loadView(em, customer.id, bookingId, true);
  }

  /** Rates the driver of my completed tow, once. Updates the driver's average in the same transaction. */
  async rate(
    userId: string,
    bookingId: string,
    rating: number,
    comment: string | undefined,
  ): Promise<BookingView> {
    const customerId = await this.dataSource.transaction(async (em) => {
      const customer = await this.vehicles.customerOf(em, userId);
      const booking = await em.findOne(Booking, {
        where: { id: bookingId, customerId: customer.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Booking not found.');
      if (booking.status !== BookingStatus.Completed || !booking.driverId) {
        throw new ConflictException('You can rate a tow once it is completed.');
      }
      if (booking.customerRating) throw new ConflictException('You already rated this tow.');
      await em.update(Booking, booking.id, {
        customerRating: rating,
        customerReview: comment ?? null,
        ratedAt: new Date(),
      });
      await em.query(
        `UPDATE drivers SET rating = (
           SELECT ROUND(AVG(customer_rating)::numeric, 2) FROM bookings
            WHERE driver_id = $1 AND customer_rating IS NOT NULL)
          WHERE id = $1`,
        [booking.driverId],
      );
      return customer.id;
    });
    await this.audit.record({
      action: 'booking.rated',
      entityType: 'booking',
      entityId: bookingId,
      actorUserId: userId,
      metadata: { rating },
    });
    return this.loadView(this.dataSource.manager, customerId, bookingId, true);
  }

  async cancel(userId: string, bookingId: string, reason: string): Promise<BookingView> {
    return this.cancelAs({ userId, by: CancelledBy.Customer }, bookingId, reason);
  }

  /** Operations can cancel any open booking (e.g. a stuck job), at any stage. */
  async cancelByAdmin(
    adminUserId: string,
    bookingId: string,
    reason: string,
  ): Promise<BookingView> {
    return this.cancelAs({ userId: adminUserId, by: CancelledBy.Admin }, bookingId, reason);
  }

  private async cancelAs(
    actor: { userId: string; by: CancelledBy.Customer | CancelledBy.Admin },
    bookingId: string,
    reason: string,
  ): Promise<BookingView> {
    const { userId } = actor;
    const byAdmin = actor.by === CancelledBy.Admin;
    const notifyDriverUserIds: { userId: string; event: string; payload: unknown }[] = [];
    const notifyCustomer: { userId: string }[] = [];
    const customerId = await this.dataSource.transaction(async (em) => {
      const customer = byAdmin ? null : await this.vehicles.customerOf(em, userId);
      const booking = await em.findOne(Booking, {
        where: customer ? { id: bookingId, customerId: customer.id } : { id: bookingId },
        lock: { mode: 'pessimistic_write' }, // no race with a driver accepting the job
      });
      if (!booking) throw new NotFoundException('Booking not found.');
      if (booking.status === BookingStatus.Cancelled) {
        throw new ConflictException('This booking is already cancelled.');
      }
      if (booking.status === BookingStatus.Completed) {
        throw new ConflictException('This tow is already completed.');
      }
      if (!byAdmin && !customerCanCancel(booking.status)) {
        throw new ConflictException(
          'The tow truck is already on scene, so this booking can no longer be cancelled in the app. Contact TowNow support.',
        );
      }
      if (byAdmin)
        notifyCustomer.push({ userId: await this.customerUserId(em, booking.customerId) });
      const feeMayApply = cancellationFeeMayApply(booking.status);

      // Withdraw a ringing offer (lock order booking → offer → driver, as in matching).
      const pending = await em.findOne(BookingOffer, {
        where: { bookingId: booking.id, status: OfferStatus.Pending },
        lock: { mode: 'pessimistic_write' },
      });
      if (pending) {
        await em.update(BookingOffer, pending.id, {
          status: OfferStatus.Cancelled,
          respondedAt: new Date(),
        });
        const offered = await em.findOneByOrFail(Driver, { id: pending.driverId });
        notifyDriverUserIds.push({
          userId: offered.userId,
          event: RealtimeEvent.OfferClosed,
          payload: { offerId: pending.id, reason: 'cancelled' },
        });
      }
      // Release an assigned driver back to online.
      if (booking.driverId) {
        const driver = await em.findOne(Driver, {
          where: { id: booking.driverId },
          lock: { mode: 'pessimistic_write' },
        });
        if (driver) {
          if (
            driver.availability === DriverAvailability.Busy ||
            driver.availability === DriverAvailability.EnRoute
          ) {
            await em.update(Driver, driver.id, { availability: DriverAvailability.Online });
          }
          notifyDriverUserIds.push({
            userId: driver.userId,
            event: RealtimeEvent.JobCancelled,
            payload: { bookingId: booking.id },
          });
        }
      }
      await em.update(Booking, booking.id, {
        status: BookingStatus.Cancelled,
        cancelledAt: new Date(),
        cancelledBy: actor.by,
        cancellationReason: reason,
      });
      await em.insert(BookingStatusHistory, {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: BookingStatus.Cancelled,
        actorUserId: userId,
        note: `Cancelled by ${actor.by}: ${reason}${feeMayApply ? ' (driver was already assigned)' : ''}`.slice(
          0,
          255,
        ),
      });
      return booking.customerId;
    });

    for (const n of notifyDriverUserIds) this.emitter.toUser(n.userId, n.event, n.payload);
    for (const c of notifyCustomer) {
      this.emitter.toUser(c.userId, RealtimeEvent.BookingUpdated, {
        bookingId,
        status: BookingStatus.Cancelled,
      });
    }
    await this.payments.enqueueRelease(bookingId); // release any card hold; no fee is charged
    await this.audit.record({
      action: 'booking.cancelled',
      entityType: 'booking',
      entityId: bookingId,
      actorUserId: userId,
      metadata: { reason, cancelledBy: actor.by },
    });
    return this.loadView(this.dataSource.manager, customerId, bookingId, true);
  }

  private async customerUserId(em: EntityManager, customerId: string): Promise<string> {
    return (await em.findOneByOrFail(Customer, { id: customerId })).userId;
  }

  private async insertFromQuote(
    em: EntityManager,
    userId: string,
    customer: Customer,
    quote: StoredQuote,
    dto: CreateBookingDto,
  ): Promise<string> {
    // The vehicle may have been removed or changed since the quote was made.
    const vehicle = await this.vehicles.findOwned(em, customer.id, quote.vehicleId);
    if (!isTowTypeCompatible(vehicle.category, quote.towType)) {
      throw new BadRequestException(
        'This vehicle changed since the quote. Please get a new quote.',
      );
    }

    const [{ nextval }]: { nextval: string }[] = await em.query(
      "SELECT nextval('booking_number_seq') AS nextval",
    );
    const { fare } = quote;
    const booking = await em.save(
      em.create(Booking, {
        bookingNumber: formatBookingNumber(nextval),
        quoteId: quote.id,
        customerId: customer.id,
        customerVehicleId: vehicle.id,
        towType: quote.towType,
        issue: dto.issue,
        notes: dto.notes ?? null,
        status: BookingStatus.Requested,
        pickupPoint: toPoint(quote.pickup),
        pickupAddress: quote.pickup.address,
        dropoffPoint: toPoint(quote.dropoff),
        dropoffAddress: quote.dropoff.address,
        distanceMeters: quote.distanceMeters,
        estimatedDurationSeconds: quote.estimatedDurationSeconds,
        pricingRuleId: quote.pricingRuleId,
        baseFareFils: fare.baseFareFils,
        distanceChargeFils: fare.distanceChargeFils,
        towTypeChargeFils: fare.towTypeSurchargeFils,
        additionalChargesFils: fare.nightSurchargeFils + fare.minimumFareAdjustmentFils,
        subtotalFils: fare.subtotalFils,
        vatRateBps: fare.vatRateBps,
        vatFils: fare.vatFils,
        totalFils: fare.totalFils,
        currency: fare.currency,
        fareSnapshot: {
          tariff: quote.tariff,
          fare: quote.fare,
          distanceSource: quote.distanceSource,
          quotedAt: quote.quotedAt,
        },
        paymentMethod: dto.paymentMethod,
      }),
    );
    await em.insert(BookingStatusHistory, {
      bookingId: booking.id,
      fromStatus: null,
      toStatus: BookingStatus.Requested,
      actorUserId: userId,
      note: 'Tow requested by customer',
    });
    return booking.id;
  }

  private async findByQuote(customer: Customer, quoteId: string): Promise<BookingView | null> {
    const booking = await this.dataSource.manager.findOneBy(Booking, { quoteId });
    if (!booking || booking.customerId !== customer.id) return null;
    return this.loadView(this.dataSource.manager, customer.id, booking.id, true);
  }

  private async loadView(
    em: EntityManager,
    customerId: string,
    bookingId: string,
    withHistory: boolean,
  ): Promise<BookingView> {
    const booking = await em.findOne(Booking, {
      where: { id: bookingId, customerId },
      relations: { customerVehicle: true, driver: { user: true }, towTruck: true },
      withDeleted: true,
    });
    if (!booking) throw new NotFoundException('Booking not found.');
    const view = BookingsService.toView(booking, booking.customerVehicle);
    view.payment = await this.payments.summaryFor(bookingId);
    if (withHistory) {
      const history = await em.find(BookingStatusHistory, {
        where: { bookingId },
        order: { createdAt: 'ASC' },
      });
      view.history = history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        at: h.createdAt,
      }));
    }
    return view;
  }

  static toView(b: Booking, vehicle: CustomerVehicle): BookingView {
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: b.status,
      createdAt: b.createdAt,
      vehicle: CustomerVehicleView.from(vehicle),
      towType: b.towType,
      issue: b.issue,
      notes: b.notes,
      pickup: { ...fromPoint(b.pickupPoint), address: b.pickupAddress },
      dropoff: { ...fromPoint(b.dropoffPoint), address: b.dropoffAddress },
      distanceMeters: b.distanceMeters,
      estimatedDurationSeconds: b.estimatedDurationSeconds,
      fare: {
        baseFareFils: b.baseFareFils,
        distanceChargeFils: b.distanceChargeFils,
        towTypeChargeFils: b.towTypeChargeFils,
        additionalChargesFils: b.additionalChargesFils,
        subtotalFils: b.subtotalFils,
        vatRateBps: b.vatRateBps,
        vatFils: b.vatFils,
        totalFils: b.totalFils,
        currency: b.currency,
      },
      paymentMethod: b.paymentMethod,
      canCancel: customerCanCancel(b.status),
      cancellationFeeMayApply: cancellationFeeMayApply(b.status),
      cancelledAt: b.cancelledAt,
      cancelledBy: b.cancelledBy,
      cancellationReason: b.cancellationReason,
      // Only what the customer needs to recognise the truck — no phone, no surname.
      driver:
        b.driver && b.towTruck
          ? {
              firstName: b.driver.user?.fullName?.split(' ')[0] ?? 'Your driver',
              rating: b.driver.rating,
              totalTrips: b.driver.totalTrips,
              truck: {
                towType: b.towTruck.towType,
                model: b.towTruck.model,
                plateEmirate: b.towTruck.plateEmirate,
                plateCode: b.towTruck.plateCode,
                plateNumber: b.towTruck.plateNumber,
              },
            }
          : null,
      payment: null,
      myRating:
        b.customerRating && b.ratedAt
          ? { rating: b.customerRating, comment: b.customerReview, ratedAt: b.ratedAt }
          : null,
    };
  }
}
