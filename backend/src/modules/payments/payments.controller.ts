import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiExcludeEndpoint,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentMethod, UserRole } from '../../common/enums.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, Public, Roles } from '../auth/decorators.js';
import {
  CommissionBalanceView,
  DriverLedgerView,
  InvoiceView,
  PaymentSessionView,
  PaymentSummaryView,
  RecordCashDto,
  RefundDto,
  SettlementDto,
} from './payment.dto.js';
import { PaymentsService } from './payments.service.js';

/** Customer side of a booking's payment and invoice. */
@ApiTags('Payments')
@ApiBearerAuth()
@Controller('bookings/:bookingId')
export class BookingPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payment')
  @Roles(UserRole.Customer)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Payment form data for an unpaid card / Apple Pay booking (idempotent)',
  })
  @ApiOkResponse({ type: PaymentSessionView })
  @ApiConflictResponse({ description: 'Cash booking or cancelled' })
  session(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
  ): Promise<PaymentSessionView> {
    return this.payments.paymentSession(auth.userId, id);
  }

  @Post('payment/sync')
  @Roles(UserRole.Customer)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-read the payment state from the gateway (after the card form)' })
  @ApiOkResponse({ type: PaymentSummaryView })
  sync(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
  ): Promise<PaymentSummaryView> {
    return this.payments.sync(auth.userId, id);
  }

  @Get('invoice')
  @Roles(UserRole.Customer, UserRole.Driver, UserRole.Admin)
  @ApiOperation({ summary: 'Invoice of a completed tow (receipt until the TRN is configured)' })
  @ApiOkResponse({ type: InvoiceView })
  @ApiNotFoundResponse({ description: 'Not yours, or not completed yet' })
  invoice(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
  ): Promise<InvoiceView> {
    return this.payments.invoice(auth, id);
  }
}

/** Which payment methods bookings accept right now (cash always; card / Apple Pay only with Stripe). */
@ApiTags('Payments')
@Controller('payments')
export class PaymentMethodsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Get('methods')
  @ApiOperation({ summary: 'Payment methods accepted for new bookings' })
  methods(): { methods: PaymentMethod[] } {
    return {
      methods: this.payments.cardPaymentsEnabled
        ? [PaymentMethod.Cash, PaymentMethod.Card, PaymentMethod.ApplePay]
        : [PaymentMethod.Cash],
    };
  }
}

/** Gateway → TowNow. Authenticated by signature, not by a user token. */
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async stripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true; duplicate: boolean }> {
    const { duplicate } = await this.payments.handleStripeWebhook(req.rawBody, signature);
    return { received: true, duplicate };
  }
}

/** The signed-in driver's cash confirmation and earnings. */
@ApiTags('Payments (driver)')
@ApiBearerAuth()
@Roles(UserRole.Driver)
@Controller('drivers/me')
export class DriverPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('jobs/:bookingId/cash-collected')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the full cash fare was collected (completed cash jobs; idempotent)',
  })
  @ApiOkResponse({ type: PaymentSummaryView })
  cashCollected(
    @CurrentAuth() auth: AuthContext,
    @Param('bookingId', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordCashDto,
  ): Promise<PaymentSummaryView> {
    return this.payments.recordCash(auth.userId, id, dto.amountFils);
  }

  @Get('earnings')
  @ApiOperation({ summary: 'My settlement balance and ledger (+ TowNow owes me, − I owe TowNow)' })
  @ApiOkResponse({ type: DriverLedgerView })
  earnings(@CurrentAuth() auth: AuthContext): Promise<DriverLedgerView> {
    return this.payments.myLedger(auth.userId);
  }
}

@ApiTags('Admin · Payments')
@ApiBearerAuth()
@Roles(UserRole.Admin)
@Controller('admin')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments/:paymentId/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fully refund a captured card payment (audited; idempotent)' })
  @ApiOkResponse({ type: PaymentSummaryView })
  refund(
    @CurrentAuth() auth: AuthContext,
    @Param('paymentId', new ParseUUIDPipe()) id: string,
    @Body() dto: RefundDto,
  ): Promise<PaymentSummaryView> {
    return this.payments.refund(auth.userId, id, dto.reason);
  }

  @Get('drivers/:driverId/ledger')
  @ApiOperation({ summary: "A driver's settlement balance and ledger" })
  @ApiOkResponse({ type: DriverLedgerView })
  ledger(@Param('driverId', new ParseUUIDPipe()) id: string): Promise<DriverLedgerView> {
    return this.payments.driverLedger(id);
  }

  @Get('commissions')
  @ApiOperation({ summary: 'Settlement balance of every driver, most owed to TowNow first' })
  @ApiOkResponse({ type: [CommissionBalanceView] })
  commissions(): Promise<CommissionBalanceView[]> {
    return this.payments.commissionBalances();
  }

  @Post('drivers/:driverId/settlements')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record a remittance (driver → TowNow) or payout (TowNow → driver); idempotent by reference',
  })
  @ApiOkResponse({ type: DriverLedgerView })
  settle(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId', new ParseUUIDPipe()) id: string,
    @Body() dto: SettlementDto,
  ): Promise<DriverLedgerView> {
    return this.payments.recordSettlement(auth.userId, id, dto);
  }
}
