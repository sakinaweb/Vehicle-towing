import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BookingStatus } from '../../../common/enums.js';
import { User } from '../../users/entities/user.entity.js';
import { Booking } from './booking.entity.js';

/** Append-only timeline of a tow job's status changes. */
@Entity('booking_status_history')
@Index('ix_booking_status_history_booking', ['bookingId', 'createdAt'])
export class BookingStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn()
  booking!: Booking;

  @Column({ type: 'uuid' })
  bookingId!: string;

  @Column({ type: 'enum', enum: BookingStatus, enumName: 'booking_status', nullable: true })
  fromStatus!: BookingStatus | null;

  @Column({ type: 'enum', enum: BookingStatus, enumName: 'booking_status' })
  toStatus!: BookingStatus;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  actorUser!: User | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
