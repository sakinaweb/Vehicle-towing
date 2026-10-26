import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { DisputeStatus, UserRole } from '../../../common/enums.js';
import { Booking } from '../../bookings/entities/booking.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** A complaint about a job, raised by its customer or driver and settled by operations. */
@Entity('disputes')
@Index('ix_disputes_status_created', ['status', 'createdAt'])
// One open dispute per booking at a time (re-raising after a decision is allowed).
@Index('uq_disputes_open_booking', ['bookingId'], { unique: true, where: '"status" = \'open\'' })
export class Dispute extends BaseEntity {
  @ManyToOne(() => Booking, { onDelete: 'RESTRICT' })
  @JoinColumn()
  booking!: Booking;

  @Column({ type: 'uuid' })
  bookingId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn()
  raisedBy!: User;

  @Column({ type: 'uuid' })
  raisedById!: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role' })
  raisedByRole!: UserRole;

  @Column({ type: 'varchar', length: 1000 })
  reason!: string;

  @Column({
    type: 'enum',
    enum: DisputeStatus,
    enumName: 'dispute_status',
    default: DisputeStatus.Open,
  })
  status!: DisputeStatus;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  resolution!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  resolvedBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedById!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;
}
