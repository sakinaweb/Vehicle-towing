import { ApiClient } from './api';
import type { Inspection } from './dispatch';
import type { PaymentSummary } from './payments';
import type {
  Booking,
  DriverPartner,
  CustomerVehicle,
  Emirate,
  LocationItem,
  PaymentMethod,
  TowType,
  TripStatus,
  VehicleIssue,
} from '../types';

// ---------- API shapes (money in integer fils) ----------

export interface ApiVehicle {
  id: string;
  category: 'car' | 'motorbike';
  brand: string;
  model: string;
  year: number;
  color: string | null;
  plateEmirate: Emirate;
  plateCode: string;
  plateNumber: string;
  isDefault: boolean;
  createdAt: string;
}

export interface VehicleInput {
  category: 'car' | 'motorbike';
  brand: string;
  model: string;
  year: number;
  color?: string;
  plateEmirate: Emirate;
  plateCode: string;
  plateNumber: string;
  isDefault?: boolean;
}

export interface Tariff {
  towType: TowType;
  baseFareFils: number;
  perKmFils: number;
  minimumFareFils: number;
  towTypeSurchargeFils: number;
  nightSurchargeFils: number;
  vatRateBps: number;
  currency: string;
}

export interface PlaceInput {
  lat: number;
  lng: number;
  address: string;
}

export interface QuoteFare {
  baseFareFils: number;
  distanceChargeFils: number;
  towTypeSurchargeFils: number;
  nightSurchargeFils: number;
  minimumFareAdjustmentFils: number;
  subtotalFils: number;
  vatRateBps: number;
  vatFils: number;
  totalFils: number;
  currency: string;
}

export interface Quote {
  quoteId: string;
  expiresAt: string;
  vehicleId: string;
  towType: TowType;
  pickup: PlaceInput;
  dropoff: PlaceInput;
  distanceMeters: number;
  estimatedDurationSeconds: number;
  distanceSource: string;
  fare: QuoteFare;
}

export interface ApiBooking {
  id: string;
  bookingNumber: string;
  status: TripStatus;
  createdAt: string;
  vehicle: ApiVehicle;
  towType: TowType;
  issue: VehicleIssue;
  notes: string | null;
  pickup: PlaceInput;
  dropoff: PlaceInput;
  distanceMeters: number;
  estimatedDurationSeconds: number | null;
  fare: {
    baseFareFils: number;
    distanceChargeFils: number;
    towTypeChargeFils: number;
    additionalChargesFils: number;
    subtotalFils: number;
    vatRateBps: number;
    vatFils: number;
    totalFils: number;
    currency: string;
  };
  paymentMethod: PaymentMethod;
  canCancel: boolean;
  cancellationFeeMayApply: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  /** Set once a driver accepts — first name and truck only, never contact details. */
  driver: AssignedDriver | null;
  /** Card: created at booking. Cash: set when the driver confirms collection. */
  payment: PaymentSummary | null;
  /** The customer's own rating, once given (rating is allowed once per completed tow). */
  myRating?: { rating: number; comment: string | null; ratedAt: string } | null;
  history?: { fromStatus: TripStatus | null; toStatus: TripStatus; note: string | null; at: string }[];
}

export interface AssignedDriver {
  firstName: string;
  rating: number | null;
  totalTrips: number;
  truck: { towType: TowType; model: string; plateEmirate: string; plateCode: string; plateNumber: string };
}

export interface BookingList {
  items: ApiBooking[];
  total: number;
  page: number;
  limit: number;
}

// ---------- calls ----------

const VEHICLES = '/customers/me/vehicles';

export const listVehicles = (api: ApiClient) => api.request<ApiVehicle[]>(VEHICLES);
export const createVehicle = (api: ApiClient, input: VehicleInput) =>
  api.request<ApiVehicle>(VEHICLES, { method: 'POST', body: input });
export const updateVehicle = (api: ApiClient, id: string, input: Partial<VehicleInput>) =>
  api.request<ApiVehicle>(`${VEHICLES}/${id}`, { method: 'PATCH', body: input });
export const removeVehicle = (api: ApiClient, id: string) =>
  api.request<void>(`${VEHICLES}/${id}`, { method: 'DELETE' });

export const getTariffs = (api: ApiClient) =>
  api.request<Tariff[]>('/pricing/tariffs', { auth: false });

export const requestQuote = (
  api: ApiClient,
  input: { vehicleId: string; towType: TowType; pickup: PlaceInput; dropoff: PlaceInput },
) => api.request<Quote>('/bookings/quotes', { method: 'POST', body: input });

export const createBooking = (
  api: ApiClient,
  input: { quoteId: string; issue: VehicleIssue; notes?: string; paymentMethod: PaymentMethod },
) => api.request<ApiBooking>('/bookings', { method: 'POST', body: input });

export const listBookings = (api: ApiClient, limit = 50) =>
  api.request<BookingList>(`/bookings?limit=${limit}`);
export const getBooking = (api: ApiClient, id: string) => api.request<ApiBooking>(`/bookings/${id}`);
export const cancelBooking = (api: ApiClient, id: string, reason: string) =>
  api.request<ApiBooking>(`/bookings/${id}/cancel`, { method: 'POST', body: { reason } });

// ---------- live trip (customer) ----------

export interface TripEta {
  target: 'pickup' | 'dropoff';
  status: 'available' | 'unavailable';
  durationSeconds?: number;
  distanceMeters?: number;
  source?: string;
  reason?: 'not_configured' | 'provider_error' | 'no_route' | 'location_unavailable';
}

export interface LiveDriverLocation {
  lat: number;
  lng: number;
  recordedAt: string;
  ageSeconds: number;
  /** Too old to show as live. */
  stale: boolean;
  headingDegrees?: number;
}

export interface DriverLocationView {
  bookingId: string;
  status: TripStatus;
  location: LiveDriverLocation | null;
  eta: TripEta | null;
}

export const getDriverLocation = (api: ApiClient, bookingId: string) =>
  api.request<DriverLocationView>(`/bookings/${bookingId}/driver-location`);
export const listBookingInspections = async (api: ApiClient, bookingId: string) =>
  (await api.request<{ inspections: Inspection[] }>(`/bookings/${bookingId}/inspections`)).inspections;
export const getInspectionPhoto = (api: ApiClient, bookingId: string, photoId: string) =>
  api.request<Blob>(`/bookings/${bookingId}/inspections/photos/${photoId}`, { responseType: 'blob' });

/** Honest ETA text: a real routed estimate, or why there is none (never a made-up number). */
export function etaLabel(eta: TripEta | null): string {
  if (!eta) return '';
  if (eta.status === 'available' && eta.durationSeconds !== undefined) {
    return `ETA ${Math.max(1, Math.round(eta.durationSeconds / 60))} min`;
  }
  return eta.reason === 'location_unavailable' ? 'Waiting for driver GPS' : 'ETA unavailable';
}

/** The driver marker sits at the real live position, never a guessed one. */
export function withLiveLocation<T extends object>(driver: T, fix: { lat: number; lng: number }): T & Pick<DriverPartner, 'currentLocation'> {
  return { ...driver, currentLocation: { name: 'Live position', coordinates: latLngToMap(fix), lat: fix.lat, lng: fix.lng } };
}

// ---------- presentation helpers ----------

export const filsToAed = (fils: number) => fils / 100;
export const formatAed = (fils: number) => `AED ${(fils / 100).toFixed(2)}`;
export const isFinalStatus = (s: TripStatus) => s === 'completed' || s === 'cancelled';

/** Mirrors the API rule (server is the authority): which equipment can carry which vehicle. */
export function towTypeFits(category: 'car' | 'motorbike', towType: TowType): boolean {
  return category === 'car' ? towType !== 'bike-carrier' : towType !== 'wheel-lift';
}

/**
 * Legacy 0–100 `coordinates` still required by the LocationItem type (old admin demo).
 * The real map (MapPanel) uses lat/lng only.
 */
const MAP_BOX = { north: 25.35, south: 24.95, west: 54.95, east: 55.45 };

export function latLngToMap({ lat, lng }: { lat: number; lng: number }) {
  const clamp = (v: number) => Math.min(98, Math.max(2, v));
  return {
    x: clamp(((lng - MAP_BOX.west) / (MAP_BOX.east - MAP_BOX.west)) * 100),
    y: clamp(((MAP_BOX.north - lat) / (MAP_BOX.north - MAP_BOX.south)) * 100),
  };
}

export function toUiVehicle(v: ApiVehicle): CustomerVehicle {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    year: v.year,
    color: v.color ?? '',
    plateNumber: v.plateNumber,
    plateCode: v.plateCode,
    plateEmirate: v.plateEmirate,
    category: v.category,
    isDefault: v.isDefault,
  };
}

export function toUiPlace(id: string, p: PlaceInput): LocationItem {
  return {
    id,
    name: p.address,
    address: p.address,
    city: p.lat < 24.8 ? 'Abu Dhabi' : 'Dubai',
    coordinates: latLngToMap(p),
    lat: p.lat,
    lng: p.lng,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Assigned driver → the UI's DriverPartner shape used by DriverCard (unknown fields neutral). */
export function toUiDriver(d: AssignedDriver, pickup: PlaceInput): DriverPartner {
  return {
    id: `driver-${d.firstName}`,
    name: d.firstName,
    avatar: '',
    phone: '',
    rating: d.rating ?? 0, // 0 = no reviews yet (shown as "New")
    totalTrips: d.totalTrips,
    experienceYears: 0,
    kycStatus: 'approved',
    status: 'en_route',
    vehicle: {
      type: d.truck.towType,
      plateNumber: `${d.truck.plateEmirate} ${d.truck.plateCode} ${d.truck.plateNumber}`,
      model: d.truck.model,
      year: 0,
    },
    currentLocation: { name: pickup.address, coordinates: latLngToMap(pickup) },
    earningsToday: 0,
    earningsWeek: 0,
    completedJobsToday: 0,
    acceptanceRate: 0,
  };
}

/** API booking → the UI's Booking shape, so existing cards and screens render it. */
export function toUiBooking(
  b: ApiBooking,
  customer: { id: string; name: string; phone: string },
): Booking {
  return {
    id: b.id,
    bookingNumber: b.bookingNumber,
    createdAt: formatDate(b.createdAt),
    status: b.status,
    customer,
    vehicle: toUiVehicle(b.vehicle),
    issue: b.issue,
    towType: b.towType,
    pickup: toUiPlace(`${b.id}-pickup`, b.pickup),
    destination: toUiPlace(`${b.id}-dropoff`, b.dropoff),
    notes: b.notes ?? undefined,
    driver: b.driver ? toUiDriver(b.driver, b.pickup) : undefined,
    fareBreakdown: {
      baseFare: filsToAed(b.fare.baseFareFils),
      distanceCharge: filsToAed(b.fare.distanceChargeFils),
      towTypeCharge: filsToAed(b.fare.towTypeChargeFils),
      additionalCharges: filsToAed(b.fare.additionalChargesFils),
      subtotal: filsToAed(b.fare.subtotalFils),
      vat: filsToAed(b.fare.vatFils),
      total: filsToAed(b.fare.totalFils),
    },
    paymentMethod: b.paymentMethod,
    paymentStatus: 'pending',
    etaMinutes: Math.round((b.estimatedDurationSeconds ?? 0) / 60),
    distanceKm: b.distanceMeters / 1000,
  };
}

export interface PlaceSearch {
  status: 'available' | 'unavailable';
  reason?: 'not_configured' | 'provider_error';
  results: { address: string; lat: number; lng: number }[];
}

/** UAE address search through the server's geocoder (no maps key in the browser). */
export const searchPlaces = (api: ApiClient, q: string) =>
  api.request<PlaceSearch>(`/locations/search?q=${encodeURIComponent(q)}`);

export const rateBooking = (api: ApiClient, bookingId: string, rating: number, comment?: string) =>
  api.request<ApiBooking>(`/bookings/${bookingId}/rating`, {
    method: 'POST',
    body: comment ? { rating, comment } : { rating },
  });

export interface Dispute {
  id: string;
  bookingId: string;
  bookingNumber: string;
  raisedByRole: 'customer' | 'driver' | 'admin';
  reason: string;
  status: 'open' | 'resolved' | 'rejected';
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Raise a dispute about a job (customer or assigned driver; one open dispute per job). */
export const raiseDispute = (api: ApiClient, bookingId: string, reason: string) =>
  api.request<Dispute>(`/bookings/${bookingId}/disputes`, { method: 'POST', body: { reason } });
export const getMyDisputes = (api: ApiClient) => api.request<Dispute[]>('/me/disputes');

export interface NearbyAvailability {
  radiusMeters: number;
  byTowType: { towType: TowType; available: number; nearestMeters: number | null }[];
}

/** Online, approved trucks near a point, per tow type (counts only; positions are never exposed). */
export const getNearby = (api: ApiClient, p: { lat: number; lng: number }) =>
  api.request<NearbyAvailability>(`/availability/nearby?lat=${p.lat}&lng=${p.lng}`);
