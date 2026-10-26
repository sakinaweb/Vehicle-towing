import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import type { Point } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { geoPointColumn, numericTransformer } from '../../../common/entities/column-types.js';
import { DriverAvailability, KycStatus } from '../../../common/enums.js';
import { User } from '../../users/entities/user.entity.js';

/** Tow operator / driver partner profile; one per user with role=driver. */
@Entity('drivers')
@Index('ix_drivers_dispatch', ['kycStatus', 'availability'])
export class Driver extends BaseEntity {
  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn()
  user!: User;

  @Index('uq_drivers_user', { unique: true })
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: KycStatus, enumName: 'kyc_status', default: KycStatus.Pending })
  kycStatus!: KycStatus;

  @Column({
    type: 'enum',
    enum: DriverAvailability,
    enumName: 'driver_availability',
    default: DriverAvailability.Offline,
  })
  availability!: DriverAvailability;

  /** Average rating 1.00–5.00; null until the first review. */
  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  rating!: number | null;

  @Column({ type: 'integer', default: 0 })
  totalTrips!: number;

  @Column({ type: 'smallint', default: 0 })
  experienceYears!: number;

  /** Percentage 0–100 of offered jobs accepted. */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  acceptanceRate!: number | null;

  /** Last reported GPS position, used for nearest-driver matching. */
  @Index('ix_drivers_current_location', { spatial: true })
  @Column(geoPointColumn({ nullable: true }))
  currentLocation!: Point | null;

  @Column({ type: 'timestamptz', nullable: true })
  locationUpdatedAt!: Date | null;

  // ---- KYC review (admin) ----

  @Column({ type: 'timestamptz', nullable: true })
  kycReviewedAt!: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  kycReviewedBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  kycReviewedById!: string | null;

  /** Shown to the driver so they know what to fix and resubmit. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  kycRejectionReason!: string | null;
}
