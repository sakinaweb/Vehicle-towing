import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NOTIFICATIONS_QUEUE, NotificationsService, PushJobData } from './notifications.service.js';

/** Push delivery (FCM), retried with backoff on provider outages. */
@Processor(NOTIFICATIONS_QUEUE, { concurrency: 10 })
export class NotificationsProcessor extends WorkerHost {
  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  process(job: Job<PushJobData>): Promise<void> {
    return this.notifications.push(job.data.notificationId);
  }
}
