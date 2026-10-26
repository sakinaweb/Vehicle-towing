import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { UserRole, UserStatus } from '../../../common/enums.js';

@Entity('users')
export class User extends BaseEntity {
  /** E.164 format, e.g. +971501234567. Primary login identifier (OTP). */
  @Index('uq_users_phone', { unique: true })
  @Column({ type: 'varchar', length: 20 })
  phone!: string;

  @Index('uq_users_email', { unique: true, where: '"email" IS NOT NULL' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  fullName!: string | null;

  @Index('ix_users_role')
  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role' })
  role!: UserRole;

  @Column({ type: 'enum', enum: UserStatus, enumName: 'user_status', default: UserStatus.Active })
  status!: UserStatus;

  @Column({ type: 'timestamptz', nullable: true })
  phoneVerifiedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;
}
