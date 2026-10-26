import { ApiClient } from './api';
import type { PlaceInput } from './bookings';
import type { TowType, TripStatus, VehicleIssue } from '../types';

export type DriverAvailability = 'offline' | 'online' | 'busy' | 'en_route';

export interface AvailabilityState {
  availability: DriverAvailability;
  locationUpdatedAt: string | null;
}

/** A job as the driver sees it — no customer phone or surname. */
export interface DriverJob {
  bookingId: string;
  bookingNumber: string;
  status: TripStatus;
  towType: TowType;
  issue: VehicleIssue;
  notes: string | null;
  vehicle: { category: 'car' | 'motorbike'; brand: string; model: string; color: string | null; plate: string };
  pickup: PlaceInput;
  dropoff: PlaceInput;
  tripDistanceMeters: number;
  fareTotalFils: number;
  driverPayoutFils: number;
  currency: string;
  customerFirstName: string;
  /** cash = collect the total on delivery; card / apple_pay = charged by TowNow. */
  paymentMethod: 'cash' | 'card' | 'apple_pay';
  inspections: { pickup: InspectionState; return: InspectionState };
}

export type InspectionState = 'none' | 'draft' | 'submitted';

export interface JobOffer extends DriverJob {
  offerId: string;
  offerStatus: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  distanceToPickupMeters: number;
  expiresAt: string;
}

export interface LocationFix {
  lat: number;
  lng: number;
  recordedAt: string;
  accuracyMeters?: number;
  headingDegrees?: number;
}

const ME = '/drivers/me';

export const getAvailability = (api: ApiClient) => api.request<AvailabilityState>(`${ME}/availability`);
export const setAvailability = (api: ApiClient, status: 'online' | 'offline') =>
  api.request<AvailabilityState>(`${ME}/availability`, { method: 'PUT', body: { status } });
export const postLocation = (api: ApiClient, fix: LocationFix) =>
  api.request<{ lat: number; lng: number; recordedAt: string }>(`${ME}/location`, {
    method: 'POST',
    body: fix,
  });
export const getCurrentOffer = async (api: ApiClient) =>
  (await api.request<{ offer: JobOffer | null }>(`${ME}/offers/current`)).offer;
export const acceptOffer = (api: ApiClient, offerId: string) =>
  api.request<DriverJob>(`${ME}/offers/${offerId}/accept`, { method: 'POST' });
export const declineOffer = (api: ApiClient, offerId: string) =>
  api.request<void>(`${ME}/offers/${offerId}/decline`, { method: 'POST' });
export const getCurrentJob = async (api: ApiClient) =>
  (await api.request<{ job: DriverJob | null }>(`${ME}/jobs/current`)).job;
/** Trip steps, in order. Each is idempotent on the server. */
export type TripStep = 'en-route' | 'arrived' | 'start-tow' | 'complete';
export const advanceTrip = (api: ApiClient, bookingId: string, step: TripStep) =>
  api.request<DriverJob>(`${ME}/jobs/${bookingId}/${step}`, { method: 'POST' });
export const startEnRoute = (api: ApiClient, bookingId: string) => advanceTrip(api, bookingId, 'en-route');

// ---------------------------------------------------------------- inspections

export type InspectionStage = 'pickup' | 'return';
export type FuelLevel = 'empty' | 'quarter' | 'half' | 'three_quarters' | 'full';
export type PhotoSlot = 'front' | 'back' | 'left' | 'right' | 'extra';
export const CHECKLIST_ITEMS = ['body', 'glass', 'lights', 'tyres', 'mirrors', 'interior'] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];
export type Checklist = Record<ChecklistItem, 'ok' | 'damaged'>;
export const REQUIRED_SLOTS: PhotoSlot[] = ['front', 'back', 'left', 'right'];
export const MAX_EXTRA_PHOTOS = 6;

export interface InspectionPhoto {
  id: string;
  slot: PhotoSlot;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface Inspection {
  id: string;
  stage: InspectionStage;
  odometerKm: number;
  fuelLevel: FuelLevel;
  checklist: Checklist;
  notes: string | null;
  submittedAt: string | null;
  photos: InspectionPhoto[];
}

export interface InspectionDetails {
  odometerKm: number;
  fuelLevel: FuelLevel;
  checklist: Checklist;
  notes?: string;
}

const job = (bookingId: string) => `${ME}/jobs/${bookingId}/inspections`;

export const listJobInspections = async (api: ApiClient, bookingId: string) =>
  (await api.request<{ inspections: Inspection[] }>(job(bookingId))).inspections;
export const saveInspection = (api: ApiClient, bookingId: string, stage: InspectionStage, details: InspectionDetails) =>
  api.request<Inspection>(`${job(bookingId)}/${stage}`, { method: 'PUT', body: details });
export const uploadInspectionPhoto = (
  api: ApiClient,
  bookingId: string,
  stage: InspectionStage,
  slot: PhotoSlot,
  file: File,
) => {
  const form = new FormData();
  form.append('slot', slot);
  form.append('file', file);
  return api.request<Inspection>(`${job(bookingId)}/${stage}/photos`, { method: 'POST', body: form });
};
export const deleteInspectionPhoto = (api: ApiClient, bookingId: string, stage: InspectionStage, photoId: string) =>
  api.request<Inspection>(`${job(bookingId)}/${stage}/photos/${photoId}`, { method: 'DELETE' });
export const submitInspection = (api: ApiClient, bookingId: string, stage: InspectionStage) =>
  api.request<Inspection>(`${job(bookingId)}/${stage}/submit`, { method: 'POST' });

// ---------------------------------------------------------------- KYC documents

export type KycStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type DocumentType = 'emirates_id' | 'driving_licence' | 'vehicle_registration' | 'commercial_insurance';
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  emirates_id: 'Emirates ID',
  driving_licence: 'UAE Driving Licence',
  vehicle_registration: 'Vehicle Registration (Mulkiya)',
  commercial_insurance: 'Commercial Insurance',
};

export interface DriverDocument {
  id: string;
  type: DocumentType;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  documentNumber: string | null;
  expiresOn: string | null;
  rejectionReason: string | null;
  uploadedAt: string;
}

export const listDocuments = async (api: ApiClient) =>
  (await api.request<{ documents: DriverDocument[] }>(`${ME}/documents`)).documents;
export const uploadDocument = (api: ApiClient, type: DocumentType, file: File, documentNumber?: string) => {
  const form = new FormData();
  form.append('file', file);
  if (documentNumber) form.append('documentNumber', documentNumber);
  return api.request<DriverDocument>(`${ME}/documents/${type}`, { method: 'PUT', body: form });
};
