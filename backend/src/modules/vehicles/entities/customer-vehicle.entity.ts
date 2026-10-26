import { Column, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Emirate, VehicleCategory } from '../../../common/enums.js';
import { Customer } from '../../customers/entities/customer.entity.js';

/** A customer's registered car or motorbike (the vehicle being towed). */
@Entity('customer_vehicles')
@Index('ix_customer_vehicles_customer', ['customerId'])
@Index('uq_customer_vehicles_plate', ['customerId', 'plateEmirate', 'plateCode', 'plateNumber'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class CustomerVehicle extends BaseEntity {
  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn()
  customer!: Customer;

  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'enum', enum: VehicleCategory, enumName: 'vehicle_category' })
  category!: VehicleCategory;

  @Column({ type: 'varchar', length: 60 })
  brand!: string;

  @Column({ type: 'varchar', length: 80 })
  model!: string;

  @Column({ type: 'smallint' })
  year!: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  color!: string | null;

  @Column({ type: 'enum', enum: Emirate, enumName: 'emirate' })
  plateEmirate!: Emirate;

  @Column({ type: 'varchar', length: 3 })
  plateCode!: string;

  @Column({ type: 'varchar', length: 6 })
  plateNumber!: string;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  /** Soft delete: past bookings keep referencing the vehicle. */
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
