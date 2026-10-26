import { BookingStatus, TowType, VehicleCategory } from '../../common/enums.js';

/** States in which a tow is finished and no longer occupies the vehicle. */
export const FINAL_STATUSES: readonly BookingStatus[] = [
  BookingStatus.Completed,
  BookingStatus.Cancelled,
];

/**
 * A customer may cancel until the truck is on scene. Before a driver is assigned
 * it is free; once a driver is on the way a cancellation fee may apply (charged
 * by the payments phase). After arrival the tow can only be stopped via support.
 */
export const CUSTOMER_CANCELLABLE: readonly BookingStatus[] = [
  BookingStatus.Requested,
  BookingStatus.Searching,
  BookingStatus.DriverAssigned,
  BookingStatus.DriverArriving,
];

const FEE_MAY_APPLY: readonly BookingStatus[] = [
  BookingStatus.DriverAssigned,
  BookingStatus.DriverArriving,
];

export const isActive = (s: BookingStatus) => !FINAL_STATUSES.includes(s);
export const customerCanCancel = (s: BookingStatus) => CUSTOMER_CANCELLABLE.includes(s);
export const cancellationFeeMayApply = (s: BookingStatus) => FEE_MAY_APPLY.includes(s);

/** Which tow equipment can safely carry which vehicle. */
const COMPATIBLE: Record<VehicleCategory, readonly TowType[]> = {
  [VehicleCategory.Car]: [TowType.Flatbed, TowType.WheelLift],
  [VehicleCategory.Motorbike]: [TowType.BikeCarrier, TowType.Flatbed],
};

export function isTowTypeCompatible(category: VehicleCategory, towType: TowType): boolean {
  return COMPATIBLE[category].includes(towType);
}

/** Trips shorter than this are almost certainly a mis-placed pin. */
export const MIN_TRIP_METERS = 100;
/** Longest tow accepted (Ruwais → Fujairah is ~450 km by road). */
export const MAX_TRIP_METERS = 500_000;

/** Customer-facing booking reference from the database sequence: TN-100001. */
export function formatBookingNumber(sequenceValue: number | string): string {
  return `TN-${sequenceValue}`;
}
