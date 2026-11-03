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
  body: { direction: 'remittance' | 'payout'; amountFils: number; reference: string; allowExceeding?: boolean },
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

// ---------------------------------------------------------------- live map, money, audit, SOS, chat

export interface DriverPin {
  driverId: string;
  fullName: string | null;
  phone: string;
  availability: string;
  lat: number;
  lng: number;
  locationUpdatedAt: string | null;
  activeBookingNumber: string | null;
}
export const getDriverLocations = (all: boolean) =>
  api.request<DriverPin[]>(`/admin/driver-locations?all=${all}`);

export interface PaymentRow {
  paymentId: string;
  bookingId: string;
  bookingNumber: string;
  bookingStatus: string;
  method: string;
  status: string;
  amountFils: number;
  subtotalFils: number | null;
  vatFils: number | null;
  driverEarningFils: number | null;
  commissionFils: number | null;
  customerPhone: string;
  customerName: string | null;
  driverPhone: string | null;
  driverName: string | null;
  createdAt: string;
  capturedAt: string | null;
  refundedAt: string | null;
}
export interface PaymentsPage {
  totals: {
    count: number;
    collectedFils: number;
    vatFils: number;
    driverEarningsFils: number;
    commissionFils: number;
  };
  items: PaymentRow[];
  page: number;
  limit: number;
}
export interface PaymentFilter {
  method: string;
  /** YYYY-MM-DD (UAE calendar day) or '' */
  from: string;
  to: string;
}
const paymentQuery = (f: PaymentFilter) =>
  `${f.method ? `&method=${f.method}` : ''}${f.from ? `&from=${f.from}` : ''}${f.to ? `&to=${f.to}` : ''}`;
export const listPayments = (f: PaymentFilter, page: number, limit = 50) =>
  api.request<PaymentsPage>(`/admin/payments?page=${page}&limit=${limit}${paymentQuery(f)}`);

/** Every payment matching the filter as CSV (all pages; spreadsheet-formula safe). */
export async function paymentsCsv(f: PaymentFilter): Promise<string> {
  const rows: PaymentRow[] = [];
  for (let page = 1; ; page++) {
    const p = await listPayments(f, page, 200);
    rows.push(...p.items);
    if (rows.length >= p.totals.count || p.items.length === 0) break;
  }
  const money = (fils: number | null) => (fils == null ? '' : (fils / 100).toFixed(2));
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet must never run it as a formula
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    'Date (UTC)',
    'Booking',
    'Booking status',
    'Method',
    'Payment status',
    'Total AED',
    'Subtotal AED',
    'VAT AED',
    'Driver earning AED',
    'TowNow commission AED',
    'Customer',
    'Driver',
    'Refunded at',
  ];
  const lines = rows.map((r) =>
    [
      r.capturedAt ?? r.createdAt,
      r.bookingNumber,
      r.bookingStatus,
      r.method,
      r.status,
      money(r.amountFils),
      money(r.subtotalFils),
      money(r.vatFils),
      money(r.driverEarningFils),
      money(r.commissionFils),
      r.customerName ?? r.customerPhone,
      r.driverName ?? r.driverPhone ?? '',
      r.refundedAt ?? '',
    ]
      .map(cell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\r\n');
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  actorPhone: string | null;
  actorRole: string | null;
  actorName: string | null;
  createdAt: string;
}
export const listAudit = (action: string, page: number) =>
  api.request<{ items: AuditRow[]; total: number; page: number; limit: number }>(
    `/admin/audit-logs?page=${page}&limit=50${action ? `&action=${encodeURIComponent(action)}` : ''}`,
  );

export interface Sos {
  id: string;
  status: 'open' | 'acknowledged' | 'resolved';
  raisedByRole: 'customer' | 'driver';
  raisedByPhone: string;
  raisedByName: string | null;
  bookingId: string | null;
  bookingNumber: string | null;
  lat: number | null;
  lng: number | null;
  accuracyMeters: number | null;
  note: string | null;
  resolution: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}
/** No status = everything not yet resolved. */
export const listSos = (status?: Sos['status']) =>
  api.request<Sos[]>(`/admin/sos${status ? `?status=${status}` : ''}`);
export const acknowledgeSos = (id: string) =>
  api.request<Sos>(`/admin/sos/${id}/acknowledge`, { method: 'POST' });
export const resolveSos = (id: string, resolution: string) =>
  api.request<Sos>(`/admin/sos/${id}/resolve`, {
    method: 'POST',
    body: resolution ? { resolution } : {},
  });

export interface ChatMsg {
  id: string;
  senderRole: 'customer' | 'driver';
  body: string;
  createdAt: string;
  readAt: string | null;
}
export const getChat = (bookingId: string) => api.request<ChatMsg[]>(`/bookings/${bookingId}/messages`);

// ---------------------------------------------------------------- customers, suspension, refunds

export interface CustomerRow {
  userId: string;
  customerId: string | null;
  fullName: string | null;
  phone: string;
  email: string | null;
  status: 'active' | 'suspended';
  createdAt: string;
  bookings: number;
  completedBookings: number;
  activeBookings: number;
  spentFils: number;
  lastBookingAt: string | null;
}
export const listCustomers = (q: string, status: '' | 'active' | 'suspended', page: number) =>
  api.request<{ items: CustomerRow[]; total: number; page: number; limit: number }>(
    `/admin/customers?page=${page}&limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`,
  );
export const suspendUser = (userId: string, reason: string) =>
  api.request<{ status: string; sessionsEnded: number }>(`/admin/users/${userId}/suspend`, {
    method: 'POST',
    body: { reason },
  });
export const reactivateUser = (userId: string, reason: string) =>
  api.request<{ status: string }>(`/admin/users/${userId}/reactivate`, { method: 'POST', body: { reason } });
/** Full refund of a captured card payment (cash is refunded outside the app). */
export const refundPayment = (paymentId: string, reason: string) =>
  api.request<unknown>(`/admin/payments/${paymentId}/refund`, { method: 'POST', body: { reason } });
