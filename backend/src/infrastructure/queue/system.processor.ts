import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { HeartbeatResult, SYSTEM_QUEUE, SystemJob } from './queue.constants.js';

@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  process(job: Job): Promise<HeartbeatResult> {
    if (job.name !== SystemJob.Heartbeat) {
      throw new Error(`Unknown system job: ${job.name}`);
    }
    this.logger.debug(`Heartbeat job ${job.id} processed`);
    return Promise.resolve({ ok: true, processedAt: new Date().toISOString() });
  }
}
