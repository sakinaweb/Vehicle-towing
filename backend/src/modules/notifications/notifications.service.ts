import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Queue } from 'bullmq';
import { DataSource, In, IsNull } from 'typeorm';
import { DevicePlatform } from '../../common/enums.js';
import { RealtimeEmitter } from '../../infrastructure/realtime/realtime.emitter.js';
import { DeviceToken } from './entities/device-token.entity.js';
import { Notification } from './entities/notification.entity.js';
import { FcmClient, FcmError } from './fcm.client.js';
import { messageFor, NotificationMessage } from './notification.messages.js';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const PushJob = 'push';
export interface PushJobData {
  notificationId: string;
}

/** Most app installs one account keeps tokens for (oldest are dropped). */
const MAX_DEVICES_PER_USER = 10;

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token' })
  @IsString()
  @Length(20, 512)
  token!: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}

export class RemoveDeviceDto {
  @ApiProperty() @IsString() @Length(20, 512) token!: string;
}

export class InboxQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class NotificationView {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty() data!: Record<string, unknown>;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) readAt!: Date | null;
}

export class InboxView {
  @ApiProperty({ type: [NotificationView] }) items!: NotificationView[];
  @ApiProperty() unread!: number;
  @ApiProperty() total!: number;
}

/**
 * In-app inbox + push. Domain code doesn't call this: it mirrors the realtime events
 * it already emits (after commit), so a backgrounded app still hears about them.
 * A notification failure never affects the booking flow.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<PushJobData>,
    private readonly emitter: RealtimeEmitter,
    private readonly fcm: FcmClient,
  ) {}

  onModuleInit(): void {
    this.emitter.onEmit((userId, event, payload) => {
      const msg = messageFor(event, payload);
      if (!msg) return;
      this.notify(userId, msg).catch((err: Error) =>
        this.logger.warn(`Notification ${msg.type} for ${userId} not stored: ${err.message}`),
      );
    });
  }

  async notify(userId: string, msg: NotificationMessage): Promise<void> {
    const row = await this.dataSource.manager.save(
      this.dataSource.manager.create(Notification, {
        userId,
        type: msg.type,
        title: msg.title,
        body: msg.body,
        data: msg.data,
      }),
    );
    if (this.fcm.enabled) {
      await this.queue.add(PushJob, { notificationId: row.id }, { jobId: `push-${row.id}` });
    }
  }

  /** Sends one notification to every device of its user; dead tokens are removed. */
  async push(notificationId: string): Promise<void> {
    const n = await this.dataSource.manager.findOneBy(Notification, { id: notificationId });
    if (!n) return;
    const devices = await this.dataSource.manager.findBy(DeviceToken, { userId: n.userId });
    const msg: NotificationMessage = {
      type: n.type,
      title: n.title,
      body: n.body,
      data: Object.fromEntries(Object.entries(n.data).map(([k, v]) => [k, String(v)])),
    };
    let retryable: Error | null = null;
    for (const d of devices) {
      try {
        await this.fcm.send(d.token, msg);
      } catch (err) {
        if (err instanceof FcmError && err.tokenIsDead) {
          await this.dataSource.manager.delete(DeviceToken, { id: d.id });
        } else if (err instanceof FcmError && err.status < 500 && err.status !== 429) {
          this.logger.warn(`FCM rejected a message (${err.status}): ${err.message}`);
        } else {
          retryable = err as Error;
        }
      }
    }
    // ponytail: a retry re-sends to devices that already got it; track per-device delivery if duplicates matter.
    if (retryable) throw retryable;
  }

  async registerDevice(userId: string, dto: RegisterDeviceDto): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO device_tokens (user_id, token, platform, last_seen_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (token) DO UPDATE
         SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
             last_seen_at = now(), updated_at = now()`,
      [userId, dto.token, dto.platform],
    );
    await this.dataSource.query(
      `DELETE FROM device_tokens WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM device_tokens WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT $2)`,
      [userId, MAX_DEVICES_PER_USER],
    );
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    await this.dataSource.manager.delete(DeviceToken, { userId, token });
  }

  async inbox(userId: string, q: InboxQuery): Promise<InboxView> {
    const em = this.dataSource.manager;
    const [rows, total] = await em.findAndCount(Notification, {
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
    const unread = await em.countBy(Notification, { userId, readAt: IsNull() });
    return {
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        createdAt: n.createdAt,
        readAt: n.readAt,
      })),
      unread,
      total,
    };
  }

  async markRead(userId: string, ids: string[] | 'all'): Promise<void> {
    const where =
      ids === 'all' ? { userId, readAt: IsNull() } : { userId, id: In(ids), readAt: IsNull() };
    const res = await this.dataSource.manager.update(Notification, where, { readAt: new Date() });
    if (ids !== 'all' && ids.length === 1 && !res.affected) {
      const exists = await this.dataSource.manager.existsBy(Notification, { userId, id: ids[0] });
      if (!exists) throw new NotFoundException('Notification not found.');
    }
  }
}
