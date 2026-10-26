import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { Point } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { geoPointColumn, moneyColumn } from '../../../common/entities/column-types.js';
import {
  BookingStatus,
  CancelledBy,
  PaymentMethod,
  TowType,
  VehicleIssue,
} from '../../../common/enums.js';
import { Customer } from '../../customers/entities/customer.entity.js';
import { Driver } from '../../drivers/entities/driver.entity.js';
import { TowTruck } from '../../drivers/entities/tow-truck.entity.js';
import { ServiceZone } from '../../locations/entities/service-zone.entity.js';
import { PricingRule } from '../../pricing/entities/pricing-rule.entity.js';
import { CustomerVehicle } from '../../vehicles/entities/customer-vehicle.entity.js';

/** A tow job from request to completion. Fare fields are an immutable snapshot (fils). */
@Entity('bookings')
@Index('ix_bookings_customer_created', ['customerId', 'createdAt'])
@Index('ix_bookings_driver_status', ['driverId', 'status'])
@Index('ix_bookings_status', ['status'])
// A vehicle can have only one tow in progress at a time.
@Index('uq_bookings_active_vehicle', ['customerVehicleId'], {
  unique: true,
  where: "\"status\" NOT IN ('completed', 'cancelled')",
})
export class Booking extends BaseEntity {
  /** Human-facing reference from booking_number_seq, e.g. TN-100001. */
  @Index('uq_bookings_booking_number', { unique: true })
  @Column({ type: 'varchar', length: 20 })
  bookingNumber!: string;

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn()
  customer!: Customer;

  @Column({ type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => CustomerVehicle, { onDelete: 'RESTRICT' })
  @JoinColumn()
  customerVehicle!: CustomerVehicle;

  @Column({ type: 'uuid' })
  customerVehicleId!: string;

  @ManyToOne(() => Driver, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn()
  driver!: Driver | null;

  @Column({ type: 'uuid', nullable: true })
  driverId!: string | null;

  @ManyToOne(() => TowTruck, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn()
  towTruck!: TowTruck | null;

  @Column({ type: 'uuid', nullable: true })
  towTruckId!: string | null;

  @Column({ type: 'enum', enum: TowType, enumName: 'tow_type' })
  towType!: TowType;

  @Column({ type: 'enum', enum: VehicleIssue, enumName: 'vehicle_issue' })
  issue!: VehicleIssue;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    enumName: 'booking_status',
    default: BookingStatus.Requested,
  })
  status!: BookingStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Index('ix_bookings_pickup_point', { spatial: true })
  @Column(geoPointColumn())
  pickupPoint!: Point;

  @Column({ type: 'text' })
  pickupAddress!: string;

  @Column(geoPointColumn())
  dropoffPoint!: Point;

  @Column({ type: 'text' })
  dropoffAddress!: string;

  @ManyToOne(() => ServiceZone, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn()
  serviceZone!: ServiceZone | null;

  @Column({ type: 'uuid', nullable: true })
  serviceZoneId!: string | null;

  /** Route distance/duration from the routing provider at quote time. */
  @Column({ type: 'integer' })
  distanceMeters!: number;

  @Column({ type: 'integer', nullable: true })
  estimatedDurationSeconds!: number | null;

  @ManyToOne(() => PricingRule, { onDelete: 'RESTRICT' })
  @JoinColumn()
  pricingRule!: PricingRule;

  @Column({ type: 'uuid' })
  pricingRuleId!: string;

  @Column(moneyColumn())
  baseFareFils!: number;

  @Column(moneyColumn())
  distanceChargeFils!: number;

  @Column(moneyColumn({ default: 0 }))
  towTypeChargeFils!: number;

  @Column(moneyColumn({ default: 0 }))
  additionalChargesFils!: number;

  @Column(moneyColumn())
  subtotalFils!: number;

  @Column(moneyColumn())
  vatFils!: number;

  @Column(moneyColumn())
  totalFils!: number;

  @Column({ type: 'char', length: 3, default: 'AED' })
  currency!: string;

  /** VAT rate in force when the fare was quoted (500 = 5%). */
  @Column({ type: 'integer' })
  vatRateBps!: number;

  /** Full quote as priced: tariff values, breakdown, route source. Never recalculated. */
  @Column({ type: 'jsonb' })
  fareSnapshot!: Record<string, unknown>;

  /**
   * The server quote this booking was created from. Unique, so re-submitting the
   * same confirmation (double tap, retry after a timeout) returns the same booking.
   */
  @Index('uq_bookings_quote', { unique: true })
  @Column({ type: 'uuid' })
  quoteId!: string;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  paymentMethod!: PaymentMethod;

  @Column({ type: 'timestamptz', nullable: true })
  assignedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ type: 'enum', enum: CancelledBy, enumName: 'cancelled_by', nullable: true })
  cancelledBy!: CancelledBy | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancellationReason!: string | null;

  /** Customer's 1–5 rating of the completed tow (once); feeds drivers.rating. */
  @Column({ type: 'smallint', nullable: true })
  customerRating!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  customerReview!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  ratedAt!: Date | null;
}
