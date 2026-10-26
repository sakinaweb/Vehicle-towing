import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { FuelLevel, InspectionStage } from '../../../common/enums.js';
import { Booking } from '../../bookings/entities/booking.entity.js';
import { User } from '../../users/entities/user.entity.js';

export type ChecklistResult = 'ok' | 'damaged';

/**
 * Vehicle condition recorded by the assigned driver at pickup and at return.
 * Editable as a draft; locked once submitted (submittedAt set).
 */
@Entity('booking_inspections')
@Index('uq_booking_inspections_booking_stage', ['bookingId', 'stage'], { unique: true })
export class BookingInspection extends BaseEntity {
  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn()
  booking!: Booking;

  @Column({ type: 'uuid' })
  bookingId!: string;

  @Column({ type: 'enum', enum: InspectionStage, enumName: 'inspection_stage' })
  stage!: InspectionStage;

  @Column({ type: 'integer' })
  odometerKm!: number;

  @Column({ type: 'enum', enum: FuelLevel, enumName: 'fuel_level' })
  fuelLevel!: FuelLevel;

  /** One result per checklist item, e.g. { body: 'ok', glass: 'damaged' }. */
  @Column({ type: 'jsonb' })
  checklist!: Record<string, ChecklistResult>;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  submittedBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  submittedById!: string | null;
}
