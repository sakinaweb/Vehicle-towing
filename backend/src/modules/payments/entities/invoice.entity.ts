import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { moneyColumn } from '../../../common/entities/column-types.js';
import { PaymentMethod } from '../../../common/enums.js';
import { Booking } from '../../bookings/entities/booking.entity.js';

/**
 * Immutable invoice snapshot issued when a tow is completed. Amounts come from the
 * booking's fare snapshot (never recalculated). Without a configured TRN the document
 * is a receipt (isTaxInvoice = false), not a UAE tax invoice.
 */
@Entity('invoices')
export class Invoice extends BaseEntity {
  @OneToOne(() => Booking, { onDelete: 'RESTRICT' })
  @JoinColumn()
  booking!: Booking;

  @Index('uq_invoices_booking', { unique: true })
  @Column({ type: 'uuid' })
  bookingId!: string;

  /** Sequential, from invoice_number_seq: INV-000001. */
  @Index('uq_invoices_number', { unique: true })
  @Column({ type: 'varchar', length: 20 })
  invoiceNumber!: string;

  @Column({ type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ type: 'varchar', length: 120 })
  sellerName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sellerAddress!: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  sellerTrn!: string | null;

  @Column({ type: 'boolean' })
  isTaxInvoice!: boolean;

  @Column({ type: 'varchar', length: 255 })
  customerName!: string;

  @Column(moneyColumn())
  subtotalFils!: number;

  @Column({ type: 'integer' })
  vatRateBps!: number;

  @Column(moneyColumn())
  vatFils!: number;

  @Column(moneyColumn())
  totalFils!: number;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  paymentMethod!: PaymentMethod;
}
