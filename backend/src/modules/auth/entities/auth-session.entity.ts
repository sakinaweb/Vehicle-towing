import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { User } from '../../users/entities/user.entity.js';

/** A signed-in device. Holds a hash of the refresh token so sessions can be revoked. */
@Entity('auth_sessions')
@Index('ix_auth_sessions_user', ['userId'])
export class AuthSession extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user!: User;

  @Column({ type: 'uuid' })
  userId!: string;

  @Index('uq_auth_sessions_refresh_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  refreshTokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  @Column({ type: 'inet', nullable: true })
  ipAddress!: string | null;

  /** Last successful refresh; null until the first rotation. */
  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;
}
