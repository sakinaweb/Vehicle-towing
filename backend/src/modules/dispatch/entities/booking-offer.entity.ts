import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { OfferStatus } from '../../../common/enums.js';
import { Booking } from '../../bookings/entities/booking.entity.js';
import { Driver } from '../../drivers/entities/driver.entity.js';
import { TowTruck } from '../../drivers/entities/tow-truck.entity.js';

/**
 * One job offer to one driver. Database constraints keep matching safe:
 * - a booking has at most one pending offer (no duplicate offers for an attempt);
 * - a driver has at most one pending offer (never two jobs ringing at once);
 * - a booking is offered to the same driver at most once.
 */
@Entity('booking_offers')
@Index('uq_booking_offers_pending_booking', ['bookingId'], {
  unique: true,
  where: `"status" = 'pending'`,
})
@Index('uq_booking_offers_pending_driver', ['driverId'], {
  unique: true,
  where: `"status" = 'pending'`,
})
@Index('uq_booking_offers_booking_driver', ['bookingId', 'driverId'], { unique: true })
@Index('ix_booking_offers_driver_created', ['driverId', 'createdAt'])
export class BookingOffer extends BaseEntity {
  @ManyToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn()
  booking!: Booking;

  @Column({ type: 'uuid' })
  bookingId!: string;

  @ManyToOne(() => Driver, { onDelete: 'CASCADE' })
  @JoinColumn()
  driver!: Driver;

  @Column({ type: 'uuid' })
  driverId!: string;

  /** The truck that qualified the driver for this tow type. */
  @ManyToOne(() => TowTruck, { onDelete: 'CASCADE' })
  @JoinColumn()
  towTruck!: TowTruck;

  @Column({ type: 'uuid' })
  towTruckId!: string;

  @Column({
    type: 'enum',
    enum: OfferStatus,
    enumName: 'offer_status',
    default: OfferStatus.Pending,
  })
  status!: OfferStatus;

  /** Driver → pickup straight-line distance when offered (PostGIS). */
  @Column({ type: 'integer' })
  distanceToPickupMeters!: number;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;
}
