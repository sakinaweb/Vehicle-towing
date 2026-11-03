import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { SosStatus, UserRole } from '../../../common/enums.js';
import { Booking } from '../../bookings/entities/booking.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** An emergency raised from the customer or driver app, handled by operations. */
@Entity('sos_alerts')
@Index('ix_sos_alerts_status_created', ['status', 'createdAt'])
export class SosAlert extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn()
  raisedBy!: User;

  @Column({ type: 'uuid' })
  raisedById!: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role' })
  raisedByRole!: UserRole;

  /** The job it happened on, when there was one. */
  @ManyToOne(() => Booking, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  booking!: Booking | null;

  @Column({ type: 'uuid', nullable: true })
  bookingId!: string | null;

  @Column({ type: 'double precision', nullable: true })
  lat!: number | null;

  @Column({ type: 'double precision', nullable: true })
  lng!: number | null;

  @Column({ type: 'real', nullable: true })
  accuracyMeters!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ type: 'enum', enum: SosStatus, enumName: 'sos_status', default: SosStatus.Open })
  status!: SosStatus;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  handledBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  handledById!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  resolution!: string | null;
}
