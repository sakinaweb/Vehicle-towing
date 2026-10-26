import { ApiClient, ApiUser } from './api';
import { PaymentMethod, TowType } from '../types';

export interface CustomerProfile {
  user: ApiUser;
  defaultPaymentMethod: PaymentMethod | null;
}

export interface TowTruckProfile {
  id: string;
  towType: TowType;
  model: string;
  year: number;
  plateEmirate: string;
  plateCode: string;
  plateNumber: string;
  isActive: boolean;
}

export interface DriverProfile {
  user: ApiUser;
  kycStatus: 'pending' | 'approved' | 'rejected' | 'suspended';
  /** Why KYC was rejected (only while rejected). */
  kycRejectionReason: string | null;
  availability: 'offline' | 'online' | 'busy' | 'en_route';
  rating: number | null;
  totalTrips: number;
  experienceYears: number;
  acceptanceRate: number | null;
  towTrucks: TowTruckProfile[];
}

export interface ContactUpdate {
  fullName?: string;
  email?: string | null;
}

export const getCustomerProfile = (api: ApiClient) =>
  api.request<CustomerProfile>('/customers/me');

export const updateCustomerProfile = (
  api: ApiClient,
  changes: ContactUpdate & { defaultPaymentMethod?: PaymentMethod },
) => api.request<CustomerProfile>('/customers/me', { method: 'PATCH', body: changes });

export const getDriverProfile = (api: ApiClient) => api.request<DriverProfile>('/drivers/me');

export const updateDriverProfile = (
  api: ApiClient,
  changes: ContactUpdate & { experienceYears?: number },
) => api.request<DriverProfile>('/drivers/me', { method: 'PATCH', body: changes });
