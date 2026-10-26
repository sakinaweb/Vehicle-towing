import { ApiClient } from './api';
import type { DocumentType, DriverDocument, KycStatus } from './dispatch';
import type { TowType } from '../types';

export interface KycQueueItem {
  driverId: string;
  fullName: string | null;
  phone: string;
  kycStatus: KycStatus;
  documentsUploaded: number;
  documentsRequired: number;
  towTrucks: number;
  /** offline | online | busy | en_route */
  availability?: string;
  registeredAt: string;
}

export interface KycQueue {
  items: KycQueueItem[];
  total: number;
  page: number;
  limit: number;
}

export interface KycDriver {
  driverId: string;
  fullName: string | null;
  phone: string;
  email: string | null;
  accountStatus: 'active' | 'suspended' | 'deleted';
  kycStatus: KycStatus;
  kycReviewedAt: string | null;
  kycRejectionReason: string | null;
  availability: string;
  experienceYears: number;
  totalTrips: number;
  registeredAt: string;
  towTrucks: {
    id: string;
    towType: TowType;
    model: string;
    year: number;
    plateEmirate: string;
    plateCode: string;
    plateNumber: string;
    isActive: boolean;
  }[];
  documents: DriverDocument[];
  missingDocuments: DocumentType[];
}

const BASE = '/admin/drivers';

export const getKycQueue = (api: ApiClient, kycStatus: KycStatus, page = 1, limit = 20) =>
  api.request<KycQueue>(`${BASE}?kycStatus=${kycStatus}&page=${page}&limit=${limit}`);
export const getKycDriver = (api: ApiClient, driverId: string) => api.request<KycDriver>(`${BASE}/${driverId}`);
export const getKycDocumentFile = (api: ApiClient, driverId: string, documentId: string) =>
  api.request<Blob>(`${BASE}/${driverId}/documents/${documentId}/file`, { responseType: 'blob' });
export const approveKyc = (api: ApiClient, driverId: string) =>
  api.request<KycDriver>(`${BASE}/${driverId}/kyc/approve`, { method: 'POST' });
export const rejectKyc = (api: ApiClient, driverId: string, reason: string) =>
  api.request<KycDriver>(`${BASE}/${driverId}/kyc/reject`, { method: 'POST', body: { reason } });
