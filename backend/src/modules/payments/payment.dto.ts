import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LedgerEntryType, PaymentMethod, PaymentStatus } from '../../common/enums.js';

/** Payment state shown on a booking. Never contains gateway secrets. */
export class PaymentSummaryView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty() amountFils!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) failureReason!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) authorizedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) capturedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) refundedAt!: Date | null;
}

/** What the app needs to show Stripe's payment form for an unpaid card booking. */
export class PaymentSessionView {
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty() amountFils!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ example: 'stripe' }) provider!: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Stripe client secret for this payment only (null once authorised)',
  })
  clientSecret!: string | null;
  @ApiProperty({ description: 'Stripe publishable key (public)' }) publishableKey!: string;
}

export class RecordCashDto {
  @ApiProperty({
    example: 28157,
    description: 'Cash collected, in fils (must equal the booking total)',
  })
  @IsInt()
  @Min(1)
  amountFils!: number;
}

export class RefundDto {
  @ApiProperty({ example: 'Customer charged for a cancelled job' })
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  reason!: string;
}

export class InvoiceView {
  @ApiProperty({ example: 'INV-000001' }) invoiceNumber!: string;
  @ApiProperty({
    description: 'False until INVOICE_TRN is configured: the document is then a receipt',
  })
  isTaxInvoice!: boolean;
  @ApiProperty({ example: 'Tax Invoice' }) title!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) notice!: string | null;
  @ApiProperty() issuedAt!: Date;
  @ApiProperty() bookingNumber!: string;
  @ApiProperty() seller!: { name: string; address: string | null; trn: string | null };
  @ApiProperty() customerName!: string;
  @ApiProperty({ description: 'Trip amount excluding VAT' }) subtotalFils!: number;
  @ApiProperty({ example: 500 }) vatRateBps!: number;
  @ApiProperty() vatFils!: number;
  @ApiProperty() totalFils!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ enum: PaymentStatus, nullable: true })
  paymentStatus!: PaymentStatus | null;
}

export class LedgerEntryView {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Null for settlements' })
  bookingId!: string | null;
  @ApiProperty({ enum: LedgerEntryType }) type!: LedgerEntryType;
  @ApiProperty({ nullable: true, type: String, description: 'Settlement payment reference' })
  reference!: string | null;
  @ApiProperty({ description: 'Signed fils: + TowNow owes the driver, − driver owes TowNow' })
  amountFils!: number;
  @ApiProperty() details!: Record<string, unknown>;
  @ApiProperty() createdAt!: Date;
}

export class DriverLedgerView {
  @ApiProperty({
    description: 'Sum of all entries: + TowNow owes the driver, − driver owes TowNow',
  })
  balanceFils!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [LedgerEntryView], description: 'Most recent 100 entries' })
  entries!: LedgerEntryView[];
}

export class SettlementDto {
  @ApiProperty({
    enum: ['remittance', 'payout'],
    description: 'remittance: driver paid TowNow · payout: TowNow paid the driver',
  })
  @IsIn(['remittance', 'payout'])
  direction!: 'remittance' | 'payout';

  @ApiProperty({ example: 6030, description: 'Positive fils' })
  @IsInt()
  @Min(1)
  amountFils!: number;

  @ApiProperty({ example: 'FT-2026-10-11-0001', description: 'Bank transfer / receipt reference' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 ._/-]{2,79}$/, {
    message: 'reference must be 3–80 letters, digits or . _ / -',
  })
  reference!: string;

  @ApiPropertyOptional({
    description: 'Confirm recording more than is currently owed (the balance then flips sides)',
  })
  @IsOptional()
  @IsBoolean()
  allowExceeding?: boolean;
}

export class CommissionBalanceView {
  @ApiProperty() driverId!: string;
  @ApiProperty({ nullable: true, type: String }) fullName!: string | null;
  @ApiProperty() phone!: string;
  @ApiProperty({ description: '+ TowNow owes the driver, − driver owes TowNow' })
  balanceFils!: number;
  @ApiProperty() completedTrips!: number;
  @ApiProperty({ nullable: true, type: Date }) lastSettlementAt!: Date | null;
}
