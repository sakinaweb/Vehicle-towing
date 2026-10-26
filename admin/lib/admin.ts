// Admin endpoints. The HTTP client and KYC calls are the web app's own (../src/services),
// shared so there is one implementation of auth, refresh and error handling.
import { ApiError, apiClients } from '@shared/services/api';
import type { SessionResponse } from '@shared/services/api';

export { ApiError };
export * from '@shared/services/adminKyc';
export const api = apiClients.admin;

export const aed = (fils: number) =>
  `AED ${(fils / 100).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB') : '—');
export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');

// ---------------------------------------------------------------- sign-in

export const requestOtp = (phone: string) =>
  api.request<void>('/auth/otp/request', { method: 'POST', body: { phone }, auth: false });
export async function verifyOtp(phone: string, code: string): Promise<SessionResponse> {
  const session = await api.request<SessionResponse>('/auth/otp/verify', {
    method: 'POST',
    body: { phone, code, role: 'admin' },
    auth: false,
  });
  api.setSession(session);
  return session;
}
export async function signOut() {
  await api.request<void>('/auth/logout', { method: 'POST' }).catch(() => undefined);
  api.setSession(null);
}

// ---------------------------------------------------------------- operations

export interface Overview {
  activeByStatus: Record<string, number>;
  driversOnline: number;
  driversPendingKyc: number;
  openDisputes: number;
  completedToday: number;
  grossTodayFils: number;
  commissionOwedFils: number;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  grossAllTimeFils: number;
  vatAllTimeFils: number;
  commissionEarnedFils: number;
}

export interface BookingRow {
  id: string;
  bookingNumber: string;
  status: string;
  createdAt: string;
  customerPhone: string;
  customerName: string | null;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  totalFils: number;
  paymentMethod: string;
  customerRating: number | null;
}

export interface BookingDetail {
  summary: BookingRow;
  history: { fromStatus: string | null; toStatus: string; note: string | null; at: string }[];
  invoiceNumber: string | null;
  paymentStatus: string | null;
  inspections: number;
  customerReview: string | null;
  cancellationReason: string | null;
}

export type BookingFilter = 'active' | 'completed' | 'cancelled' | 'all';

export const getOverview = () => api.request<Overview>('/admin/overview');
export const listBookings = (status: BookingFilter, q = '', page = 1) =>
  api.request<{ items: BookingRow[]; total: number; page: number; limit: number }>(
    `/admin/bookings?status=${status}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
export const getBooking = (id: string) => api.request<BookingDetail>(`/admin/bookings/${id}`);
export const cancelBooking = (id: string, reason: string) =>
  api.request<unknown>(`/admin/bookings/${id}/cancel`, { method: 'POST', body: { reason } });

// ---------------------------------------------------------------- money

export interface LedgerEntry {
  id: string;
  bookingId: string | null;
  type: 'trip_earning' | 'cash_collected' | 'remittance' | 'payout';
  reference: string | null;
  amountFils: number;
  createdAt: string;
}
export interface DriverLedger {
  balanceFils: number;
  currency: string;
  entries: LedgerEntry[];
}
export interface CommissionBalance {
  driverId: string;
  fullName: string | null;
  phone: string;
  balanceFils: number;
  completedTrips: number;
  lastSettlementAt: string | null;
}

export const getCommissions = () => api.request<CommissionBalance[]>('/admin/commissions');
export const getLedger = (driverId: string) => api.request<DriverLedger>(`/admin/drivers/${driverId}/ledger`);
export const recordSettlement = (
  driverId: string,
  body: { direction: 'remittance' | 'payout'; amountFils: number; reference: string },
) => api.request<DriverLedger>(`/admin/drivers/${driverId}/settlements`, { method: 'POST', body });

// ---------------------------------------------------------------- disputes

export interface Dispute {
  id: string;
  bookingId: string;
  bookingNumber: string;
  raisedByRole: string;
  reason: string;
  status: 'open' | 'resolved' | 'rejected';
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
export const listDisputes = (status: Dispute['status']) => api.request<Dispute[]>(`/admin/disputes?status=${status}`);
export const resolveDispute = (id: string, status: 'resolved' | 'rejected', resolution: string) =>
  api.request<Dispute>(`/admin/disputes/${id}/resolve`, { method: 'POST', body: { status, resolution } });

// ---------------------------------------------------------------- pricing

export interface TariffVersion {
  id: string;
  towType: string;
  baseFareFils: number;
  perKmFils: number;
  minimumFareFils: number;
  towTypeSurchargeFils: number;
  nightSurchargeFils: number;
  vatRateBps: number;
  platformCommissionBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export type TariffInput = Omit<TariffVersion, 'id' | 'vatRateBps' | 'effectiveFrom' | 'effectiveTo'>;
export const listTariffs = () => api.request<TariffVersion[]>('/admin/pricing-rules');
export const publishTariff = (body: TariffInput) =>
  api.request<TariffVersion>('/admin/pricing-rules', { method: 'POST', body });
