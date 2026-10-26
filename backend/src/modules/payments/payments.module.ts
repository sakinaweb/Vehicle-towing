import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { MATCHING_QUEUE } from '../dispatch/dispatch.constants.js';
import { DriverLedgerEntry } from './entities/driver-ledger-entry.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import { PaymentWebhookEvent } from './entities/payment-webhook-event.entity.js';
import { Payment } from './entities/payment.entity.js';
import {
  AdminPaymentsController,
  BookingPaymentsController,
  DriverPaymentsController,
  PaymentWebhooksController,
  PaymentMethodsController,
} from './payments.controller.js';
import { PaymentsProcessor } from './payments.processor.js';
import { PAYMENTS_QUEUE, PaymentsService } from './payments.service.js';
import { StripeClient } from './stripe.client.js';

/** Card payments (Stripe), cash records, invoices and the driver settlement ledger. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentWebhookEvent, Invoice, DriverLedgerEntry]),
    // Matching is started by enqueueing onto its queue (no module dependency on dispatch).
    BullModule.registerQueue({ name: PAYMENTS_QUEUE }, { name: MATCHING_QUEUE }),
    AuditModule,
  ],
  controllers: [
    BookingPaymentsController,
    PaymentWebhooksController,
    PaymentMethodsController,
    DriverPaymentsController,
    AdminPaymentsController,
  ],
  providers: [PaymentsService, StripeClient, PaymentsProcessor],
  exports: [TypeOrmModule, PaymentsService],
})
export class PaymentsModule {}
