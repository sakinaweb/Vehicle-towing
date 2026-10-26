import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { SYSTEM_QUEUE } from './queue.constants.js';
import { SystemProcessor } from './system.processor.js';

/**
 * BullMQ root connection. Feature modules register their own queues with
 * BullModule.registerQueue() and reuse this connection.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      // Workers start only where startWorkers() is called (API with RUN_WORKERS, or worker.ts).
      extraOptions: { manualRegistration: true },
      useFactory: (config: AppConfigService) => ({
        // BullMQ workers need maxRetriesPerRequest = null on their blocking connection.
        connection: { ...config.redis, maxRetriesPerRequest: null },
        prefix: config.queuePrefix,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
    BullModule.registerQueue({ name: SYSTEM_QUEUE }),
  ],
  providers: [SystemProcessor],
  exports: [BullModule],
})
export class QueueModule {}
