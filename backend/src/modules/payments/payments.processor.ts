import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PaymentJob, PaymentJobData, PAYMENTS_QUEUE, PaymentsService } from './payments.service.js';

/** Capture after completion, release after cancellation, cancel unpaid card bookings. */
@Processor(PAYMENTS_QUEUE, { concurrency: 5 })
export class PaymentsProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentsProcessor.name);

  constructor(private readonly payments: PaymentsService) {
    super();
  }

  async process(job: Job<PaymentJobData>): Promise<void> {
    switch (job.name) {
      case PaymentJob.Capture:
        return this.payments.capture(job.data.bookingId);
      case PaymentJob.Release:
        return this.payments.release(job.data.bookingId);
      case PaymentJob.AuthTimeout:
        return this.payments.authTimeout(job.data.bookingId);
      default:
        this.logger.warn(`Unknown payments job "${job.name}"`);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<PaymentJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;
    this.logger.warn(`Payments job ${job.name} for ${job.data.bookingId} failed: ${error.message}`);
    if (job.name === PaymentJob.Capture && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.payments.captureGaveUp(job.data.bookingId, error.message);
    }
  }
}
