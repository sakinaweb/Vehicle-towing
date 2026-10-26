import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { moneyColumn } from '../../../common/entities/column-types.js';
import { PaymentMethod, PaymentStatus } from '../../../common/enums.js';
import { Booking } from '../../bookings/entities/booking.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** A payment attempt for a booking. Card data never touches TowNow; only the provider's reference is kept. */
@Entity('payments')
@Index('ix_payments_booking', ['bookingId'])
// One payment per booking: a second charge for the same tow is impossible.
@Index('uq_payments_booking', ['bookingId'], { unique: true })
@Index('uq_payments_provider_reference', ['provider', 'providerReference'], {
  unique: true,
  where: '"provider_reference" IS NOT NULL',
})
export class Payment extends BaseEntity {
  @ManyToOne(() => Booking, { onDelete: 'RESTRICT' })
  @JoinColumn()
  booking!: Booking;

  @Column({ type: 'uuid' })
  bookingId!: string;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  method!: PaymentMethod;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status',
    default: PaymentStatus.Pending,
  })
  status!: PaymentStatus;

  @Column(moneyColumn())
  amountFils!: number;

  @Column({ type: 'char', length: 3, default: 'AED' })
  currency!: string;

  /** Payment gateway identifier, e.g. "stripe" or "network-international". Null for cash. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerReference!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  failureReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  authorizedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  capturedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundedAt!: Date | null;

  /** Cash only: the driver user who confirmed collecting it. */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  collectedBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  collectedById!: string | null;
}
