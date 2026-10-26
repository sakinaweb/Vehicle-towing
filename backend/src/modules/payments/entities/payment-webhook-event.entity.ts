import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Gateway webhook events already handled. The unique (provider, event_id) makes
 * redelivered events no-ops. Only identifiers are stored — never the payload.
 */
@Entity('payment_webhook_events')
@Index('uq_payment_webhook_events_event', ['provider', 'eventId'], { unique: true })
export class PaymentWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ type: 'varchar', length: 255 })
  eventId!: string;

  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt!: Date;
}
