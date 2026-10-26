import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { PaymentMethod } from '../../../common/enums.js';
import { User } from '../../users/entities/user.entity.js';

/** Customer profile; one per user with role=customer. */
@Entity('customers')
export class Customer extends BaseEntity {
  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn()
  user!: User;

  @Index('uq_customers_user', { unique: true })
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method', nullable: true })
  defaultPaymentMethod!: PaymentMethod | null;
}
