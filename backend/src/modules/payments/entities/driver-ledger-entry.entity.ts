import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LedgerEntryType } from '../../../common/enums.js';
import { Booking } from '../../bookings/entities/booking.entity.js';
import { Driver } from '../../drivers/entities/driver.entity.js';

/**
 * Append-only driver settlement ledger. Balance = SUM(amount_fils):
 * positive → TowNow owes the driver; negative → the driver owes TowNow (cash trips).
 * One entry per booking and type, so retries can never double-post. Settlements
 * (remittances/payouts) have no booking and are unique by their payment reference.
 */
@Entity('driver_ledger_entries')
@Index('uq_driver_ledger_booking_type', ['bookingId', 'type'], { unique: true })
@Index('ix_driver_ledger_driver_created', ['driverId', 'createdAt'])
@Index('uq_driver_ledger_reference', ['reference'], {
  unique: true,
  where: '"reference" IS NOT NULL',
})
export class DriverLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Driver, { onDelete: 'RESTRICT' })
  @JoinColumn()
  driver!: Driver;

  @Column({ type: 'uuid' })
  driverId!: string;

  @ManyToOne(() => Booking, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn()
  booking!: Booking | null;

  /** Null for settlements, which are not tied to one trip. */
  @Column({ type: 'uuid', nullable: true })
  bookingId!: string | null;

  @Column({ type: 'enum', enum: LedgerEntryType, enumName: 'ledger_entry_type' })
  type!: LedgerEntryType;

  /** Signed integer fils. */
  @Column({ type: 'integer' })
  amountFils!: number;

  /** Bank transfer / receipt reference of a settlement (unique, so it can't be posted twice). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference!: string | null;

  /** How the amount was derived (gross, commission rate, commission), for statements and audits. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  details!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
