import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Emirate, TowType } from '../../../common/enums.js';
import { Driver } from './driver.entity.js';

/** A recovery vehicle operated by a driver partner. */
@Entity('tow_trucks')
@Index('ix_tow_trucks_driver', ['driverId'])
@Index('uq_tow_trucks_plate', ['plateEmirate', 'plateCode', 'plateNumber'], { unique: true })
export class TowTruck extends BaseEntity {
  @ManyToOne(() => Driver, { onDelete: 'CASCADE' })
  @JoinColumn()
  driver!: Driver;

  @Column({ type: 'uuid' })
  driverId!: string;

  @Column({ type: 'enum', enum: TowType, enumName: 'tow_type' })
  towType!: TowType;

  @Column({ type: 'varchar', length: 80 })
  model!: string;

  @Column({ type: 'smallint' })
  year!: number;

  @Column({ type: 'enum', enum: Emirate, enumName: 'emirate' })
  plateEmirate!: Emirate;

  @Column({ type: 'varchar', length: 3 })
  plateCode!: string;

  @Column({ type: 'varchar', length: 6 })
  plateNumber!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
