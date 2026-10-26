import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceToken } from './entities/device-token.entity.js';
import { Notification } from './entities/notification.entity.js';
import { FcmClient } from './fcm.client.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsProcessor } from './notifications.processor.js';
import { NOTIFICATIONS_QUEUE, NotificationsService } from './notifications.service.js';

/** In-app inbox and push delivery (FCM via BullMQ). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, DeviceToken]),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor, FcmClient],
  exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}
