import { Column, Entity, Index } from 'typeorm';
import type { MultiPolygon } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { numericTransformer } from '../../../common/entities/column-types.js';
import { Emirate, ZoneStatus } from '../../../common/enums.js';

/** An operating area (e.g. "Dubai Marina, JBR & Palm"). Bookings outside all zones are not served. */
@Entity('service_zones')
export class ServiceZone extends BaseEntity {
  @Index('uq_service_zones_name', { unique: true })
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'enum', enum: Emirate, enumName: 'emirate' })
  emirate!: Emirate;

  @Column({ type: 'enum', enum: ZoneStatus, enumName: 'zone_status', default: ZoneStatus.Active })
  status!: ZoneStatus;

  @Index('ix_service_zones_area', { spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'MultiPolygon', srid: 4326 })
  area!: MultiPolygon;

  /** Demand multiplier applied to the fare, 1.00 = no surge. */
  @Column({ type: 'numeric', precision: 4, scale: 2, default: 1, transformer: numericTransformer })
  surgeMultiplier!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
