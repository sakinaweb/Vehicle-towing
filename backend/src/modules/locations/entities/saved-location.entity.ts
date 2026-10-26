import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { Point } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { geoPointColumn } from '../../../common/entities/column-types.js';
import { Emirate, SavedLocationType } from '../../../common/enums.js';
import { Customer } from '../../customers/entities/customer.entity.js';

/** A customer's saved place (home, work, preferred garage). */
@Entity('saved_locations')
@Index('ix_saved_locations_customer', ['customerId'])
export class SavedLocation extends BaseEntity {
  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn()
  customer!: Customer;

  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({
    type: 'enum',
    enum: SavedLocationType,
    enumName: 'saved_location_type',
    default: SavedLocationType.Other,
  })
  type!: SavedLocationType;

  @Column({ type: 'varchar', length: 80 })
  label!: string;

  @Column({ type: 'text' })
  address!: string;

  @Column({ type: 'enum', enum: Emirate, enumName: 'emirate' })
  emirate!: Emirate;

  @Index('ix_saved_locations_point', { spatial: true })
  @Column(geoPointColumn())
  point!: Point;
}
