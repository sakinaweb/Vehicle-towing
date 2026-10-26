/** BullMQ queue that drives the matching workflow. */
export const MATCHING_QUEUE = 'matching';

export const MatchingJob = {
  /** Find the nearest eligible driver for a booking and offer the job (or retry later). */
  Match: 'match',
  /** Expire an unanswered offer and move on to the next driver. */
  OfferTimeout: 'offer-timeout',
  /** Every minute: warn, then set offline, online drivers whose GPS stopped updating. */
  StaleLocationSweep: 'stale-location-sweep',
} as const;

export interface MatchJobData {
  bookingId: string;
}

export interface OfferTimeoutJobData {
  offerId: string;
}

// BullMQ custom job ids may not contain ":".
export const offerTimeoutJobId = (offerId: string) => `offer-timeout-${offerId}`;
