import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** Customer ↔ driver message, scoped to one booking. */
@Entity('chat_messages')
@Index('ix_chat_messages_booking_created', ['bookingId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn()
  booking!: Booking;

  @Column({ type: 'uuid' })
  bookingId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn()
  sender!: User;

  @Column({ type: 'uuid' })
  senderId!: string;

  @Column({ type: 'varchar', length: 1000 })
  body!: string;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
