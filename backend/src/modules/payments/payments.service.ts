import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  BookingStatus,
  CancelledBy,
  LedgerEntryType,
  PaymentMethod,
  PaymentStatus,
  UserRole,
} from '../../common/enums.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PaymentProviderName } from '../../config/env.validation.js';
import { RealtimeEmitter, RealtimeEvent } from '../../infrastructure/realtime/realtime.emitter.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BookingStatusHistory } from '../bookings/entities/booking-status-history.entity.js';
import { Booking } from '../bookings/entities/booking.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { MATCHING_QUEUE, MatchingJob, MatchJobData } from '../dispatch/dispatch.constants.js';
import { Driver } from '../drivers/entities/driver.entity.js';
import { PricingRule } from '../pricing/entities/pricing-rule.entity.js';
import { User } from '../users/entities/user.entity.js';
import { DriverLedgerEntry } from './entities/driver-ledger-entry.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity.js';
import { Payment } from './entities/payment.entity.js';
import {
  CommissionBalanceView,
  DriverLedgerView,
  InvoiceView,
  PaymentSessionView,
  PaymentSummaryView,
  SettlementDto,
} from './payment.dto.js';
import {
  canTransition,
  formatInvoiceNumber,
  settlement,
  statusFromIntent,
  verifyStripeSignature,
} from './payment.rules.js';
import { StripeClient, StripeError, StripePaymentIntent } from './stripe.client.js';

export const PAYMENTS_QUEUE = 'payments';
export const PaymentJob = {
  /** Capture the authorised amount after the tow is completed. */
  Capture: 'capture',
  /** Release an authorisation that will not be used (booking cancelled). */
  Release: 'release',
  /** Cancel a card booking that was never paid for. */
  AuthTimeout: 'auth-timeout',
} as const;
export interface PaymentJobData {
  bookingId: string;
}

const STRIPE = 'stripe';
type AfterCommit = (() => Promise<void> | void)[];

/**
 * Payments, invoices and the driver ledger. PostgreSQL is the source of truth;
 * the gateway is told what to do (authorise / capture / release / refund) with
 * idempotency keys, and its answers — via webhook or explicit sync — go through
 * one guarded state machine (payment.rules canTransition). Locks: booking → payment.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(PAYMENTS_QUEUE) private readonly queue: Queue,
    @InjectQueue(MATCHING_QUEUE) private readonly matchingQueue: Queue,
    private readonly stripe: StripeClient,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  get cardPaymentsEnabled(): boolean {
    return this.config.payments.provider === PaymentProviderName.Stripe;
  }

  // ---------------------------------------------------------------- booking: authorisation

  /**
   * Called right after a card / Apple Pay booking is created: schedules the unpaid
   * timeout first (so a gateway outage can never leave the booking stuck), then
   * creates the authorisation. Failures here are retried by the app via paymentSession().
   */
  async startOnlinePayment(bookingId: string): Promise<void> {
    await this.queue.add(PaymentJob.AuthTimeout, { bookingId } satisfies PaymentJobData, {
      jobId: `auth-timeout-${bookingId}`,
      delay: this.config.payments.authTimeoutMinutes * 60_000,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    try {
      await this.ensureIntent(bookingId);
    } catch (err) {
      this.logger.warn(`Could not start payment for booking ${bookingId}: ${String(err)}`);
    }
  }

  /** The customer's payment form data for an unpaid card booking (idempotent). */
  async paymentSession(userId: string, bookingId: string): Promise<PaymentSessionView> {
    const booking = await this.ownBooking(userId, bookingId);
    if (booking.paymentMethod === PaymentMethod.Cash) {
      throw new ConflictException('This booking is paid in cash to the driver.');
    }
    if (booking.status === BookingStatus.Cancelled) {
      throw new ConflictException('This booking was cancelled.');
    }
    const payment = await this.ensureIntent(bookingId);
    let clientSecret: string | null = null;
    if (payment.status === PaymentStatus.Pending || payment.status === PaymentStatus.Failed) {
      clientSecret =
        (await this.gateway(() => this.stripe.retrieve(payment.providerReference!)))
          .client_secret ?? null;
    }
    return {
      status: payment.status,
      amountFils: payment.amountFils,
      currency: payment.currency,
      provider: STRIPE,
      clientSecret,
      publishableKey: this.config.payments.stripe.publishableKey!,
    };
  }

  /** Asks the gateway for the current state (fallback when a webhook is late or blocked). */
  async sync(userId: string, bookingId: string): Promise<PaymentSummaryView> {
    await this.ownBooking(userId, bookingId);
    const payment = await this.dataSource.manager.findOneBy(Payment, { bookingId });
    if (!payment) throw new NotFoundException('No payment for this booking yet.');
    if (payment.provider === STRIPE && payment.providerReference) {
      const intent = await this.gateway(() => this.stripe.retrieve(payment.providerReference!));
      await this.applyIntent(intent, 'sync');
    }
    return PaymentsService.summary(
      await this.dataSource.manager.findOneByOrFail(Payment, { id: payment.id }),
    );
  }

  private async ensureIntent(bookingId: string): Promise<Payment> {
    if (!this.cardPaymentsEnabled)
      throw new ServiceUnavailableException('Card payments are not available.');
    const em = this.dataSource.manager;
    const existing = await em.findOneBy(Payment, { bookingId });
    if (existing?.providerReference) return existing;

    const booking = await em.findOneByOrFail(Booking, { id: bookingId });
    // Same idempotency key on every attempt → Stripe returns the same intent, never a second one.
    const intent = await this.gateway(() =>
      this.stripe.createAuthorization({
        amountFils: booking.totalFils,
        currency: booking.currency,
        bookingId,
        bookingNumber: booking.bookingNumber,
        idempotencyKey: `booking-${bookingId}-authorization`,
      }),
    );
    if (existing) {
      await em.update(Payment, existing.id, { provider: STRIPE, providerReference: intent.id });
    } else {
      await em
        .createQueryBuilder()
        .insert()
        .into(Payment)
        .values({
          bookingId,
          method: booking.paymentMethod,
          status: PaymentStatus.Pending,
          amountFils: booking.totalFils,
          currency: booking.currency,
          provider: STRIPE,
          providerReference: intent.id,
        })
        .orIgnore() // uq_payments_booking: a concurrent call already inserted it
        .execute();
    }
    return em.findOneByOrFail(Payment, { bookingId });
  }

  // ---------------------------------------------------------------- the state machine

  /**
   * Applies a gateway PaymentIntent to our record. Ignores unknown intents, amount
   * or currency mismatches (audited) and transitions the rules do not allow.
   */
  async applyIntent(
    intent: StripePaymentIntent,
    source: 'webhook' | 'sync' | 'api',
  ): Promise<void> {
    const after: AfterCommit = [];
    await this.dataSource.transaction(async (em) => {
      const peek = await em.findOneBy(Payment, { provider: STRIPE, providerReference: intent.id });
      if (!peek) {
        this.logger.warn(`Ignoring Stripe intent ${intent.id}: no matching payment`);
        return;
      }
      const booking = await em.findOneOrFail(Booking, {
        where: { id: peek.bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      const payment = await em.findOneOrFail(Payment, {
        where: { id: peek.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        intent.amount !== payment.amountFils ||
        intent.currency.toUpperCase() !== payment.currency
      ) {
        after.push(() =>
          this.audit.record({
            action: 'security.payment_amount_mismatch',
            entityType: 'payment',
            entityId: payment.id,
            metadata: { source, intentAmount: intent.amount, expected: payment.amountFils },
          }),
        );
        return;
      }
      const next = statusFromIntent(intent);
      if (next === payment.status || !canTransition(payment.status, next)) return;

      const now = new Date();
      await em.update(Payment, payment.id, {
        status: next,
        ...(next === PaymentStatus.Authorized && { authorizedAt: now }),
        ...(next === PaymentStatus.Captured && { capturedAt: now }),
        failureReason:
          next === PaymentStatus.Failed
            ? (intent.last_payment_error?.message ?? 'Payment failed').slice(0, 255)
            : null,
      });
      const customerUserId = await this.customerUserId(em, booking.customerId);
      after.push(() =>
        this.emitter.toUser(customerUserId, RealtimeEvent.PaymentUpdated, {
          bookingId: booking.id,
          status: next,
        }),
      );
      after.push(() =>
        this.audit.record({
          action: `payment.${next}`,
          entityType: 'payment',
          entityId: payment.id,
          metadata: { bookingId: booking.id, source, from: payment.status },
        }),
      );
      if (next === PaymentStatus.Authorized) {
        if (booking.status === BookingStatus.Requested) {
          after.push(() => this.enqueueMatch(booking.id)); // funds held: start dispatch
        } else if (booking.status === BookingStatus.Cancelled) {
          after.push(() => this.enqueueRelease(booking.id)); // cancelled meanwhile: release the hold
        }
      }
    });
    for (const fn of after) await fn();
  }

  // ---------------------------------------------------------------- webhooks

  /** Verifies the signature, drops duplicates, then applies the event. */
  async handleStripeWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ duplicate: boolean }> {
    const secret = this.config.payments.stripe.webhookSecret;
    if (!this.cardPaymentsEnabled || !secret) throw new NotFoundException();
    const check = rawBody
      ? verifyStripeSignature(rawBody, signature, secret, Math.floor(Date.now() / 1000))
      : ({ ok: false, reason: 'missing body' } as const);
    if (!check.ok) {
      await this.audit.record({
        action: 'security.webhook_rejected',
        entityType: 'payment_webhook',
        metadata: { provider: STRIPE, reason: check.reason },
      });
      throw new BadRequestException('Invalid webhook signature.');
    }

    const event = JSON.parse(rawBody!.toString('utf8')) as {
      id: string;
      type: string;
      data: { object: Record<string, unknown> };
    };
    const em = this.dataSource.manager;
    if (await em.existsBy(PaymentWebhookEvent, { provider: STRIPE, eventId: event.id })) {
      return { duplicate: true };
    }

    const object = event.data.object;
    if (event.type.startsWith('payment_intent.')) {
      await this.applyIntent(object as unknown as StripePaymentIntent, 'webhook');
    } else if (
      event.type === 'charge.refunded' &&
      object.refunded === true &&
      typeof object.payment_intent === 'string'
    ) {
      await this.markRefunded(object.payment_intent, 'webhook');
    }

    // Recorded after processing: a crash mid-way lets Stripe's retry try again,
    // and processing itself is idempotent, so a concurrent duplicate is harmless.
    await em
      .createQueryBuilder()
      .insert()
      .into(PaymentWebhookEvent)
      .values({ provider: STRIPE, eventId: event.id, type: event.type.slice(0, 100) })
      .orIgnore()
      .execute();
    return { duplicate: false };
  }

  // ---------------------------------------------------------------- completion, capture, release

  /**
   * Runs inside the trip-completion transaction: posts the driver's earning and issues
   * the invoice atomically with the booking becoming "completed". Returns the capture
   * to schedule after commit (card bookings).
   */
  async onTripCompleted(em: EntityManager, booking: Booking): Promise<() => Promise<void>> {
    const rule = await em.findOneByOrFail(PricingRule, { id: booking.pricingRuleId });
    const { commissionFils, driverEarningFils } = settlement(
      booking.subtotalFils,
      rule.platformCommissionBps,
    );
    await em
      .createQueryBuilder()
      .insert()
      .into(DriverLedgerEntry)
      .values({
        driverId: booking.driverId!,
        bookingId: booking.id,
        type: LedgerEntryType.TripEarning,
        amountFils: driverEarningFils,
        details: {
          bookingNumber: booking.bookingNumber,
          fareExclVatFils: booking.subtotalFils,
          commissionBps: rule.platformCommissionBps,
          commissionFils,
        },
      })
      .orIgnore()
      .execute();

    if (!(await em.existsBy(Invoice, { bookingId: booking.id }))) {
      const [{ n }]: { n: string }[] = await em.query(`SELECT nextval('invoice_number_seq') AS n`);
      const customer = await em.findOneByOrFail(Customer, { id: booking.customerId });
      const user = await em.findOneByOrFail(User, { id: customer.userId });
      const { sellerName, sellerAddress, trn } = this.config.invoice;
      await em.insert(Invoice, {
        bookingId: booking.id,
        invoiceNumber: formatInvoiceNumber(Number(n)),
        issuedAt: new Date(),
        sellerName,
        sellerAddress,
        sellerTrn: trn,
        isTaxInvoice: !!trn,
        customerName: user.fullName ?? 'Customer',
        subtotalFils: booking.subtotalFils,
        vatRateBps: booking.vatRateBps,
        vatFils: booking.vatFils,
        totalFils: booking.totalFils,
        currency: booking.currency,
        paymentMethod: booking.paymentMethod,
      });
    }
    return async () => {
      if (booking.paymentMethod !== PaymentMethod.Cash) {
        await this.queue.add(
          PaymentJob.Capture,
          { bookingId: booking.id } satisfies PaymentJobData,
          {
            jobId: `capture-${booking.id}`,
            attempts: 6,
            backoff: { type: 'exponential', delay: 10_000 },
          },
        );
      }
    };
  }

  /** Job: capture the held amount. Throws on gateway errors so BullMQ retries. */
  async capture(bookingId: string): Promise<void> {
    const payment = await this.dataSource.manager.findOneBy(Payment, { bookingId });
    if (!payment || payment.status !== PaymentStatus.Authorized || !payment.providerReference)
      return;
    const intent = await this.stripe.capture(
      payment.providerReference,
      `payment-${payment.id}-capture`,
    );
    await this.applyIntent(intent, 'api');
  }

  /** Called by the processor after the last capture attempt failed. */
  async captureGaveUp(bookingId: string, error: string): Promise<void> {
    const payment = await this.dataSource.manager.findOneBy(Payment, { bookingId });
    if (!payment || payment.status !== PaymentStatus.Authorized) return;
    await this.dataSource.manager.update(Payment, payment.id, {
      status: PaymentStatus.Failed,
      failureReason: `Capture failed: ${error}`.slice(0, 255),
    });
    await this.audit.record({
      action: 'payment.capture_failed',
      entityType: 'payment',
      entityId: payment.id,
      metadata: { bookingId },
    });
  }

  /** After a cancellation: release any hold (no fee is charged — no fee rules are approved yet). */
  async enqueueRelease(bookingId: string): Promise<void> {
    await this.queue.add(PaymentJob.Release, { bookingId } satisfies PaymentJobData, {
      jobId: `release-${bookingId}-${randomUUID()}`,
      attempts: 6,
      backoff: { type: 'exponential', delay: 10_000 },
    });
  }

  /** Job: cancel the gateway authorisation of a cancelled booking. */
  async release(bookingId: string): Promise<void> {
    const em = this.dataSource.manager;
    const payment = await em.findOneBy(Payment, { bookingId });
    if (!payment) return;
    if (
      ![PaymentStatus.Pending, PaymentStatus.Failed, PaymentStatus.Authorized].includes(
        payment.status,
      )
    )
      return;
    if (!payment.providerReference) {
      await em.update(Payment, payment.id, { status: PaymentStatus.Cancelled });
      return;
    }
    try {
      const intent = await this.stripe.cancel(
        payment.providerReference,
        `payment-${payment.id}-release`,
      );
      await this.applyIntent(intent, 'api');
    } catch (err) {
      // Already canceled / succeeded on Stripe's side: re-read the truth instead of retrying blindly.
      if (err instanceof StripeError && err.status === 400) {
        await this.applyIntent(await this.stripe.retrieve(payment.providerReference), 'api');
        return;
      }
      throw err;
    }
  }

  /** Job: a card booking still unpaid after the timeout is cancelled by the system. */
  async authTimeout(bookingId: string): Promise<void> {
    let cancelled = false;
    let customerUserId = '';
    await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking || booking.status !== BookingStatus.Requested) return;
      const payment = await em.findOne(Payment, {
        where: { bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (payment && [PaymentStatus.Authorized, PaymentStatus.Captured].includes(payment.status))
        return;
      const reason = 'Payment was not completed in time';
      await em.update(Booking, booking.id, {
        status: BookingStatus.Cancelled,
        cancelledAt: new Date(),
        cancelledBy: CancelledBy.System,
        cancellationReason: reason,
      });
      await em.insert(BookingStatusHistory, {
        bookingId,
        fromStatus: booking.status,
        toStatus: BookingStatus.Cancelled,
        actorUserId: null,
        note: reason,
      });
      customerUserId = await this.customerUserId(em, booking.customerId);
      cancelled = true;
    });
    if (!cancelled) return;
    this.emitter.toUser(customerUserId, RealtimeEvent.BookingUpdated, {
      bookingId,
      status: BookingStatus.Cancelled,
    });
    await this.audit.record({
      action: 'booking.payment_timeout',
      entityType: 'booking',
      entityId: bookingId,
    });
    await this.release(bookingId);
  }

  // ---------------------------------------------------------------- refunds (admin)

  /** Full refund of a captured card payment. Partial refunds and fee rules come later. */
  async refund(
    adminUserId: string,
    paymentId: string,
    reason: string,
  ): Promise<PaymentSummaryView> {
    const payment = await this.dataSource.manager.findOneBy(Payment, { id: paymentId });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status === PaymentStatus.Refunded) return PaymentsService.summary(payment); // idempotent
    if (payment.method === PaymentMethod.Cash) {
      throw new ConflictException(
        'Cash payments are refunded outside the app; record it with support.',
      );
    }
    if (payment.status !== PaymentStatus.Captured || !payment.providerReference) {
      throw new ConflictException(
        'Only captured card payments can be refunded. Uncaptured holds are released on cancellation.',
      );
    }
    const refund = await this.gateway(() =>
      this.stripe.refund(payment.providerReference!, `payment-${payment.id}-refund`),
    );
    await this.audit.record({
      action: 'payment.refund_requested',
      entityType: 'payment',
      entityId: payment.id,
      actorUserId: adminUserId,
      metadata: { bookingId: payment.bookingId, reason, refundStatus: refund.status },
    });
    if (refund.status === 'succeeded') await this.markRefunded(payment.providerReference, 'api');
    return PaymentsService.summary(
      await this.dataSource.manager.findOneByOrFail(Payment, { id: payment.id }),
    );
  }

  private async markRefunded(intentId: string, source: 'webhook' | 'api'): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const peek = await em.findOneBy(Payment, { provider: STRIPE, providerReference: intentId });
      if (!peek) return;
      await em.findOne(Booking, {
        where: { id: peek.bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      const payment = await em.findOneOrFail(Payment, {
        where: { id: peek.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!canTransition(payment.status, PaymentStatus.Refunded)) return;
      await em.update(Payment, payment.id, {
        status: PaymentStatus.Refunded,
        refundedAt: new Date(),
      });
      await this.audit.record({
        action: 'payment.refunded',
        entityType: 'payment',
        entityId: payment.id,
        metadata: { bookingId: payment.bookingId, source },
      });
    });
  }

  // ---------------------------------------------------------------- cash (driver)

  /** The assigned driver confirms collecting the full cash fare after completing the tow. Idempotent. */
  async recordCash(
    userId: string,
    bookingId: string,
    amountFils: number,
  ): Promise<PaymentSummaryView> {
    const id = await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      const driver = await em.findOneBy(Driver, { userId });
      if (!booking || !driver || booking.driverId !== driver.id)
        throw new NotFoundException('Job not found.');
      if (booking.paymentMethod !== PaymentMethod.Cash) {
        throw new ConflictException(
          'This job is paid by card through TowNow — do not collect cash.',
        );
      }
      if (booking.status !== BookingStatus.Completed) {
        throw new ConflictException('Complete the tow before confirming the cash payment.');
      }
      const existing = await em.findOneBy(Payment, { bookingId });
      if (existing) return existing.id; // already recorded
      if (amountFils !== booking.totalFils) {
        throw new BadRequestException(
          `Collect the full fare of AED ${(booking.totalFils / 100).toFixed(2)} (VAT included).`,
        );
      }
      const now = new Date();
      const inserted = await em.save(
        em.create(Payment, {
          bookingId,
          method: PaymentMethod.Cash,
          status: PaymentStatus.Captured,
          amountFils,
          currency: booking.currency,
          provider: null,
          providerReference: null,
          capturedAt: now,
          collectedById: userId,
        }),
      );
      await em
        .createQueryBuilder()
        .insert()
        .into(DriverLedgerEntry)
        .values({
          driverId: driver.id,
          bookingId,
          type: LedgerEntryType.CashCollected,
          amountFils: -amountFils,
          details: { bookingNumber: booking.bookingNumber, collectedFils: amountFils },
        })
        .orIgnore()
        .execute();
      await this.audit.record({
        action: 'payment.cash_collected',
        entityType: 'payment',
        entityId: inserted.id,
        actorUserId: userId,
        metadata: { bookingId, amountFils },
      });
      return inserted.id;
    });
    return PaymentsService.summary(await this.dataSource.manager.findOneByOrFail(Payment, { id }));
  }

  // ---------------------------------------------------------------- reads

  async summaryFor(bookingId: string): Promise<PaymentSummaryView | null> {
    const payment = await this.dataSource.manager.findOneBy(Payment, { bookingId });
    return payment ? PaymentsService.summary(payment) : null;
  }

  /** The booking's customer, its driver or an admin. Available once the tow is completed. */
  async invoice(viewer: AuthContext, bookingId: string): Promise<InvoiceView> {
    const em = this.dataSource.manager;
    const booking = await em.findOneBy(Booking, { id: bookingId });
    let allowed = viewer.role === UserRole.Admin;
    if (booking && viewer.role === UserRole.Customer) {
      allowed =
        booking.customerId === (await em.findOneBy(Customer, { userId: viewer.userId }))?.id;
    }
    if (booking && viewer.role === UserRole.Driver) {
      allowed = booking.driverId === (await em.findOneBy(Driver, { userId: viewer.userId }))?.id;
    }
    if (!booking || !allowed) throw new NotFoundException('Booking not found.');
    const inv = await em.findOneBy(Invoice, { bookingId });
    if (!inv) throw new NotFoundException('The invoice is issued when the tow is completed.');
    const payment = await em.findOneBy(Payment, { bookingId });
    return {
      invoiceNumber: inv.invoiceNumber,
      isTaxInvoice: inv.isTaxInvoice,
      title: inv.isTaxInvoice ? 'Tax Invoice' : 'Receipt',
      notice: inv.isTaxInvoice
        ? null
        : "Not a tax invoice: TowNow's VAT registration number (TRN) is not configured yet.",
      issuedAt: inv.issuedAt,
      bookingNumber: booking.bookingNumber,
      seller: { name: inv.sellerName, address: inv.sellerAddress, trn: inv.sellerTrn },
      customerName: inv.customerName,
      subtotalFils: inv.subtotalFils,
      vatRateBps: inv.vatRateBps,
      vatFils: inv.vatFils,
      totalFils: inv.totalFils,
      currency: inv.currency,
      paymentMethod: inv.paymentMethod,
      paymentStatus: payment?.status ?? null,
    };
  }

  async driverLedger(driverId: string): Promise<DriverLedgerView> {
    const em = this.dataSource.manager;
    const [{ balance }]: { balance: string | null }[] = await em.query(
      'SELECT SUM(amount_fils) AS balance FROM driver_ledger_entries WHERE driver_id = $1',
      [driverId],
    );
    const entries = await em.find(DriverLedgerEntry, {
      where: { driverId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return {
      balanceFils: Number(balance ?? 0),
      currency: 'AED',
      entries: entries.map((e) => ({
        id: e.id,
        bookingId: e.bookingId,
        type: e.type,
        reference: e.reference,
        amountFils: e.amountFils,
        details: e.details,
        createdAt: e.createdAt,
      })),
    };
  }

  /** Every driver with ledger activity; most owed to TowNow first. */
  async commissionBalances(): Promise<CommissionBalanceView[]> {
    const rows: {
      driver_id: string;
      full_name: string | null;
      phone: string;
      balance: string;
      trips: string;
      last_settlement_at: Date | null;
    }[] = await this.dataSource.query(
      `SELECT l.driver_id, u.full_name, u.phone, SUM(l.amount_fils) AS balance,
              COUNT(*) FILTER (WHERE l.type = 'trip_earning') AS trips,
              MAX(l.created_at) FILTER (WHERE l.type IN ('remittance', 'payout')) AS last_settlement_at
         FROM driver_ledger_entries l
         JOIN drivers d ON d.id = l.driver_id
         JOIN users u ON u.id = d.user_id
        GROUP BY l.driver_id, u.full_name, u.phone
        ORDER BY SUM(l.amount_fils) ASC`,
    );
    return rows.map((r) => ({
      driverId: r.driver_id,
      fullName: r.full_name,
      phone: r.phone,
      balanceFils: Number(r.balance),
      completedTrips: Number(r.trips),
      lastSettlementAt: r.last_settlement_at,
    }));
  }

  /**
   * Records money that changed hands outside the app (bank transfer, cash at the office).
   * Remittance (+) reduces what the driver owes; payout (−) reduces what TowNow owes.
   * The reference is unique, so re-submitting the same transfer is a no-op.
   */
  async recordSettlement(
    adminUserId: string,
    driverId: string,
    dto: SettlementDto,
  ): Promise<DriverLedgerView> {
    const driver = await this.dataSource.manager.findOneBy(Driver, { id: driverId });
    if (!driver) throw new NotFoundException('Driver not found.');
    const type =
      dto.direction === 'remittance' ? LedgerEntryType.Remittance : LedgerEntryType.Payout;
    const amountFils = dto.direction === 'remittance' ? dto.amountFils : -dto.amountFils;
    const existing = await this.dataSource.manager.findOneBy(DriverLedgerEntry, {
      reference: dto.reference,
    });
    if (existing) {
      if (
        existing.driverId !== driverId ||
        existing.type !== type ||
        existing.amountFils !== amountFils
      ) {
        throw new ConflictException('This reference was already used for a different settlement.');
      }
      return this.driverLedger(driverId);
    }
    const inserted = await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(DriverLedgerEntry)
      .values({
        driverId,
        bookingId: null,
        type,
        amountFils,
        reference: dto.reference,
        details: { recordedBy: adminUserId },
      })
      .orIgnore()
      .returning('id')
      .execute();
    if (inserted.identifiers.length > 0) {
      await this.audit.record({
        action: `settlement.${type}`,
        entityType: 'driver',
        entityId: driverId,
        actorUserId: adminUserId,
        metadata: { amountFils, reference: dto.reference },
      });
    }
    return this.driverLedger(driverId);
  }

  async myLedger(userId: string): Promise<DriverLedgerView> {
    const driver = await this.dataSource.manager.findOneBy(Driver, { userId });
    if (!driver) throw new NotFoundException('Driver profile not found.');
    return this.driverLedger(driver.id);
  }

  // ---------------------------------------------------------------- helpers

  static summary(p: Payment): PaymentSummaryView {
    return {
      id: p.id,
      method: p.method,
      status: p.status,
      amountFils: p.amountFils,
      currency: p.currency,
      failureReason: p.failureReason,
      authorizedAt: p.authorizedAt,
      capturedAt: p.capturedAt,
      refundedAt: p.refundedAt,
    };
  }

  private async enqueueMatch(bookingId: string): Promise<void> {
    await this.matchingQueue.add(MatchingJob.Match, { bookingId } satisfies MatchJobData, {
      jobId: `match-${bookingId}-${randomUUID()}`,
      attempts: 3,
    });
    await this.queue.remove(`auth-timeout-${bookingId}`).catch(() => undefined);
  }

  private async ownBooking(userId: string, bookingId: string): Promise<Booking> {
    const em = this.dataSource.manager;
    const customer = await em.findOneBy(Customer, { userId });
    const booking = await em.findOneBy(Booking, { id: bookingId });
    if (!booking || !customer || booking.customerId !== customer.id)
      throw new NotFoundException('Booking not found.');
    return booking;
  }

  private async customerUserId(em: EntityManager, customerId: string): Promise<string> {
    return (await em.findOneByOrFail(Customer, { id: customerId })).userId;
  }

  /** Gateway errors → HTTP errors the apps can show (no internals, no secrets). */
  private async gateway<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof StripeError) {
        this.logger.warn(
          `Stripe error ${err.status}${err.code ? ` (${err.code})` : ''}: ${err.message}`,
        );
        if (err.status >= 500 || err.status === 429) {
          throw new ServiceUnavailableException('The payment service is busy. Please try again.');
        }
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
