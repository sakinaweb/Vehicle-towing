import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { DevicePlatform } from '../../../common/enums.js';
import { User } from '../../users/entities/user.entity.js';

/** An FCM registration token of a signed-in app install. A token belongs to one user at a time. */
@Entity('device_tokens')
@Index('ix_device_tokens_user', ['userId'])
export class DeviceToken extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user!: User;

  @Column({ type: 'uuid' })
  userId!: string;

  @Index('uq_device_tokens_token', { unique: true })
  @Column({ type: 'varchar', length: 512 })
  token!: string;

  @Column({ type: 'enum', enum: DevicePlatform, enumName: 'device_platform' })
  platform!: DevicePlatform;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;
}
