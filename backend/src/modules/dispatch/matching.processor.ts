import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  MATCHING_QUEUE,
  MatchingJob,
  MatchJobData,
  OfferTimeoutJobData,
} from './dispatch.constants.js';
import { DriverAvailabilityService } from './driver-availability.service.js';
import { MatchingService } from './matching.service.js';

/** Worker for the matching queue. Every job is idempotent; failures are retried by BullMQ. */
@Processor(MATCHING_QUEUE, { concurrency: 5 })
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingProcessor.name);

  constructor(
    private readonly matching: MatchingService,
    private readonly availability: DriverAvailabilityService,
  ) {
    super();
  }

  async process(job: Job<MatchJobData | OfferTimeoutJobData>): Promise<void> {
    switch (job.name) {
      case MatchingJob.Match:
        await this.matching.runMatch((job.data as MatchJobData).bookingId);
        return;
      case MatchingJob.OfferTimeout:
        await this.matching.expireOffer((job.data as OfferTimeoutJobData).offerId);
        return;
      case MatchingJob.StaleLocationSweep:
        await this.availability.sweepStaleLocations();
        return;
      default:
        this.logger.warn(`Unknown matching job "${job.name}"`);
    }
  }
}
