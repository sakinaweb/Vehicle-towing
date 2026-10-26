import {
  BookingStatus,
  DriverAvailability,
  InspectionStage,
  PhotoSlot,
} from '../../common/enums.js';

/**
 * Driver-driven trip steps after assignment, on the existing booking states:
 *   driver_assigned → driver_arriving (en route) → driver_arrived
 *   → in_transit (tow started; needs the submitted pickup inspection)
 *   → completed (needs the submitted return inspection).
 * `vehicle_loaded` stays reserved: loading happens between the pickup
 * inspection and starting the tow and is not tracked as a separate step.
 */
export type TripStep = 'en-route' | 'arrived' | 'start-tow' | 'complete';

export interface TripStepRule {
  from: BookingStatus;
  to: BookingStatus;
  /** Driver availability after the step. */
  availability: DriverAvailability;
  /** Inspection that must be submitted first. */
  requires?: InspectionStage;
  note: string;
  audit: string;
}

export const TRIP_STEPS: Record<TripStep, TripStepRule> = {
  'en-route': {
    from: BookingStatus.DriverAssigned,
    to: BookingStatus.DriverArriving,
    availability: DriverAvailability.EnRoute,
    note: 'Driver is on the way',
    audit: 'trip.en_route',
  },
  arrived: {
    from: BookingStatus.DriverArriving,
    to: BookingStatus.DriverArrived,
    availability: DriverAvailability.Busy,
    note: 'Driver arrived at the pickup',
    audit: 'trip.driver_arrived',
  },
  'start-tow': {
    from: BookingStatus.DriverArrived,
    to: BookingStatus.InTransit,
    availability: DriverAvailability.Busy,
    requires: InspectionStage.Pickup,
    note: 'Vehicle loaded, tow started',
    audit: 'trip.tow_started',
  },
  complete: {
    from: BookingStatus.InTransit,
    to: BookingStatus.Completed,
    availability: DriverAvailability.Online,
    requires: InspectionStage.Return,
    note: 'Vehicle delivered, tow completed',
    audit: 'trip.completed',
  },
};

/** Booking states in which a driver is working the job. */
export const ACTIVE_TRIP_STATUSES = [
  BookingStatus.DriverAssigned,
  BookingStatus.DriverArriving,
  BookingStatus.DriverArrived,
  BookingStatus.VehicleLoaded,
  BookingStatus.InTransit,
];

const ORDER = [
  BookingStatus.DriverAssigned,
  BookingStatus.DriverArriving,
  BookingStatus.DriverArrived,
  BookingStatus.VehicleLoaded,
  BookingStatus.InTransit,
  BookingStatus.Completed,
];

export type StepDecision =
  { kind: 'apply' } | { kind: 'already-done' } | { kind: 'invalid'; message: string };

/** Whether `step` can run on a booking in `current` state. Repeating the last step is a no-op. */
export function tripStepDecision(current: BookingStatus, step: TripStep): StepDecision {
  const rule = TRIP_STEPS[step];
  if (current === rule.from) return { kind: 'apply' };
  if (current === rule.to) return { kind: 'already-done' };
  if (current === BookingStatus.Cancelled) {
    return { kind: 'invalid', message: 'This job was cancelled.' };
  }
  const at = ORDER.indexOf(current);
  if (at > ORDER.indexOf(rule.to)) {
    return { kind: 'invalid', message: 'This job has already moved past that step.' };
  }
  return { kind: 'invalid', message: STEP_PREREQUISITE[step] };
}

const STEP_PREREQUISITE: Record<TripStep, string> = {
  'en-route': 'This job is not waiting to start.',
  arrived: 'Start driving to the pickup before marking yourself arrived.',
  'start-tow': 'Mark yourself arrived at the pickup before starting the tow.',
  complete: 'Start the tow before completing it.',
};

// ---------------------------------------------------------------- inspections

/** The booking state in which each inspection is taken (and may be edited until submitted). */
export const INSPECTION_STATUS: Record<InspectionStage, BookingStatus> = {
  [InspectionStage.Pickup]: BookingStatus.DriverArrived,
  [InspectionStage.Return]: BookingStatus.InTransit,
};

export const REQUIRED_PHOTO_SLOTS = [
  PhotoSlot.Front,
  PhotoSlot.Back,
  PhotoSlot.Left,
  PhotoSlot.Right,
];
export const MAX_EXTRA_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const CHECKLIST_ITEMS = ['body', 'glass', 'lights', 'tyres', 'mirrors', 'interior'] as const;

/** Why an inspection cannot be edited right now, or null. */
export function inspectionEditError(
  stage: InspectionStage,
  bookingStatus: BookingStatus,
  submittedAt: Date | null,
): string | null {
  if (submittedAt) return 'This inspection was already submitted and can no longer be changed.';
  if (bookingStatus !== INSPECTION_STATUS[stage]) {
    return stage === InspectionStage.Pickup
      ? 'The pickup inspection is taken after arriving and before starting the tow.'
      : 'The return inspection is taken after starting the tow and before completing it.';
  }
  return null;
}

/** Return odometer can never be below the pickup reading. */
export function odometerError(
  stage: InspectionStage,
  odometerKm: number,
  pickupOdometerKm: number | null,
) {
  if (
    stage === InspectionStage.Return &&
    pickupOdometerKm !== null &&
    odometerKm < pickupOdometerKm
  ) {
    return `Return odometer (${odometerKm} km) cannot be lower than the pickup reading (${pickupOdometerKm} km).`;
  }
  return null;
}

/** Required angles still missing before the inspection can be submitted. */
export function missingPhotoSlots(slots: PhotoSlot[]): PhotoSlot[] {
  return REQUIRED_PHOTO_SLOTS.filter((s) => !slots.includes(s));
}
