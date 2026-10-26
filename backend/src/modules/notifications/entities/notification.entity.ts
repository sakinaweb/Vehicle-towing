import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { NotificationChannel } from '../../../common/enums.js';
import { User } from '../../users/entities/user.entity.js';

/** A notification addressed to a user (in-app inbox; push/SMS delivery via queue). */
@Entity('notifications')
@Index('ix_notifications_user_created', ['userId', 'createdAt'])
@Index('ix_notifications_user_unread', ['userId'], { where: '"read_at" IS NULL' })
export class Notification extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user!: User;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    enumName: 'notification_channel',
    default: NotificationChannel.InApp,
  })
  channel!: NotificationChannel;

  /** Machine-readable kind, e.g. "booking.driver_arrived" or "payment.captured". */
  @Column({ type: 'varchar', length: 60 })
  type!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  /** Deep-link payload, e.g. { bookingId }. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  data!: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;
}
