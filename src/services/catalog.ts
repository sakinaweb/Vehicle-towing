// Shared wording and small client rules, kept identical to the Flutter apps
// (mobile/townow_core/lib/src/format.dart and mobile/customer_app/lib/widgets.dart).
// No imports, so `node --test` can run src/services/catalog.test.ts directly.

/** Booking status → label, same text as the mobile apps. */
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  requested: 'Requested',
  searching: 'Finding a tow truck',
  driver_assigned: 'Driver assigned',
  driver_arriving: 'Driver on the way',
  driver_arrived: 'Driver has arrived',
  vehicle_loaded: 'Vehicle loaded',
  in_transit: 'Towing to destination',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const statusLabel = (status: string) => BOOKING_STATUS_LABELS[status] ?? status;

/** Truck equipment labels (driver side), same as mobile towTypeLabels. */
export const TOW_TYPE_LABELS: Record<string, string> = {
  flatbed: 'Flatbed',
  'wheel-lift': 'Wheel-lift',
  'bike-carrier': 'Bike carrier',
};

/** Services (one per API tow type), same titles as the mobile customer app. */
export const TOW_SERVICES = [
  { type: 'flatbed', title: 'Flatbed towing', desc: 'Safest for cars, SUVs and luxury vehicles' },
  { type: 'wheel-lift', title: 'Car towing', desc: 'Wheel-lift for short distances' },
  { type: 'bike-carrier', title: 'Motorbike towing', desc: 'Dedicated bike carrier' },
] as const;
export type TowServiceType = (typeof TOW_SERVICES)[number]['type'];
export const serviceTitle = (towType: string) =>
  TOW_SERVICES.find((s) => s.type === towType)?.title ?? towType;

/** Problem types accepted by the API, in the mobile order (first = default). */
export const VEHICLE_ISSUES = [
  'Breakdown',
  'Flat Tyre',
  'Accident',
  'Battery Issue',
  'Engine Issue',
  'Overheating',
  'Locked Out',
  'Other',
] as const;

/**
 * Payment options to show: only what the server accepts (GET /payments/methods).
 * Cash is the business model, so it is always offered and listed first.
 */
export function visiblePaymentMethods<M extends string>(accepted: readonly M[] | null): ('cash' | M)[] {
  const rest = (accepted ?? []).filter((m) => m !== 'cash');
  return ['cash', ...rest];
}

/** Rating comment sent to the API: chosen tags + free text, within the API's 500-char limit. */
export function ratingComment(tags: readonly string[], text: string): string | undefined {
  const comment = [tags.join(', '), text.trim()].filter(Boolean).join(' — ');
  return comment ? comment.slice(0, 500) : undefined;
}

/** Same bounds as the API (RaiseDisputeDto: 10–1000 characters). */
export function disputeReasonError(reason: string): string | null {
  const n = reason.trim().length;
  if (n < 10) return 'Describe the problem in at least 10 characters.';
  if (n > 1000) return 'Keep it under 1000 characters.';
  return null;
}
