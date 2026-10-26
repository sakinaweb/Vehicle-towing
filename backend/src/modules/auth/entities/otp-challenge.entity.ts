import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/** One-time passcode sent by SMS. Only a hash of the code is ever stored. */
@Entity('otp_challenges')
@Index('ix_otp_challenges_phone_created', ['phone', 'createdAt'])
export class OtpChallenge extends BaseEntity {
  @Column({ type: 'varchar', length: 20 })
  phone!: string;

  @Column({ type: 'varchar', length: 255 })
  codeHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'inet', nullable: true })
  requestIp!: string | null;
}
