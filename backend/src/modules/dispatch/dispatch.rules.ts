import { DriverAvailability } from '../../common/enums.js';

/** States a driver may set themselves; busy / en_route are set by dispatch only. */
export type DriverSettableAvailability = DriverAvailability.Online | DriverAvailability.Offline;

export interface AvailabilityContext {
  kycApproved: boolean;
  hasActiveTruck: boolean;
}

/**
 * Returns null when the change is allowed, otherwise the reason it is refused.
 * Going online needs an approved account and an active truck; a driver with a
 * job in progress (busy / en_route) must finish it before changing status.
 */
export function availabilityChangeError(
  current: DriverAvailability,
  target: DriverSettableAvailability,
  ctx: AvailabilityContext,
): string | null {
  if (current === DriverAvailability.Busy || current === DriverAvailability.EnRoute) {
    return 'You have a job in progress. Complete it before changing your status.';
  }
  if (target === DriverAvailability.Online) {
    if (!ctx.kycApproved) {
      return 'Your partner account is pending verification. You can go online once it is approved.';
    }
    if (!ctx.hasActiveTruck) {
      return 'Register an active tow truck before going online.';
    }
  }
  return null;
}

/** Allowed clock skew for timestamps sent by phones. */
export const LOCATION_FUTURE_TOLERANCE_MS = 30_000;

/**
 * Validates a driver location timestamp. Returns null if acceptable, otherwise
 * why it was rejected: from the future, too old to be useful, or older than the
 * location already stored (out-of-order delivery must not move the driver back).
 */
export function locationTimestampError(
  recordedAt: Date,
  now: Date,
  lastRecordedAt: Date | null,
  maxAgeSeconds: number,
): string | null {
  if (Number.isNaN(recordedAt.getTime())) return 'recordedAt is not a valid timestamp.';
  if (recordedAt.getTime() > now.getTime() + LOCATION_FUTURE_TOLERANCE_MS) {
    return 'recordedAt is in the future. Check the device clock.';
  }
  if (now.getTime() - recordedAt.getTime() > maxAgeSeconds * 1000) {
    return `Location is older than ${maxAgeSeconds} seconds and was not saved.`;
  }
  if (lastRecordedAt && recordedAt.getTime() <= lastRecordedAt.getTime()) {
    return 'A newer location is already recorded.';
  }
  return null;
}

/**
 * What to do about an online driver whose GPS hasn't updated for `ageSeconds`:
 * warn once it is too old for matching, set offline after `offlineAfterSeconds` (0 = never).
 */
export function staleLocationAction(
  ageSeconds: number,
  maxAgeSeconds: number,
  offlineAfterSeconds: number,
): 'offline' | 'warn' | null {
  if (offlineAfterSeconds > 0 && ageSeconds >= offlineAfterSeconds) return 'offline';
  if (ageSeconds > maxAgeSeconds) return 'warn';
  return null;
}
